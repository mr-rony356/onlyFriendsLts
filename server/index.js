// Imports
const crypto = require("crypto");
const path = require("path");
const axios = require("axios");
const bcrypt = require("bcrypt");
const cors = require("cors");
const dotenv = require("dotenv");
const express = require("express");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");
const multer = require("multer");
const next = require("next");
const database = require("./utils/db/database");
const sendEmail = require("./utils/email/sendEmail");
const payrexx = require("./utils/payrexx/payrexx");

// Access the environment file
// Switch between .env.development and .env.production state
dotenv.config({ path: `.env.${process.env.NODE_ENV}` });

// Port and DB address
const SERVER_PORT = process.env.SERVER_PORT;

// Payment setup
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Initialize next
const dev = process.env.NODE_ENV !== "production";
const server = next({ dev });
const handle = server.getRequestHandler();

server
  .prepare()
  .then(() => {
    // Initialize express
    const app = express();

    // Make public directory available to frontend
    app.use("/server/public", express.static(path.join(__dirname, "public")));

    // Use body-parser package
    app.use(
      express.json({
        verify: (req, res, buf) => {
          req.rawBody = buf.toString();
        },
      }),
    );
    app.use(express.urlencoded({ extended: true }));

    // Allow CORS
    app.use(
      cors({
        origin: [process.env.FRONTEND_URL, process.env.FRONTEND_URL_WWW],
      }),
    );

    // Use the database middleware
    app.use(database);

    // HELPERS

    /**
     * Validates the token given in the request header
     * @param {*} req JSON request
     * @param {*} res JSON response
     * @param {*} next Go forth
     * @returns Continues if the token is valid
     */
    const verifyJWT = (req, res, next) => {
      // Get the token from the request header
      const token = req.headers["x-access-token"]
        ? req.headers["x-access-token"].split(" ")[1]
        : "";

      // Check whether the token is valid
      if (!token) return res.status(400).json({ err: "The token is invalid" });

      jwt.verify(token, process.env.JWT_SECRET_KEY, (err, decoded) => {
        if (err) return res.status(500).json({ err });
        res.locals.user = decoded.name;
        next();
      });
    };

    /**
     * Specifies the storage location of all files
     */
    const storage = multer.diskStorage({
      destination: "./server/public/files",
      filename: (req, file, cb) => {
        cb(
          null,
          file.fieldname +
            "-" +
            Date.now() +
            "-" +
            Math.round(Math.random() * 1e9) +
            path.extname(file.originalname),
        );
      },
    });

    /**
     * Fetches all files given in the request header
     */
    const upload = multer({
      storage,
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB
      },
      fileFilter(req, file, cb) {
        if (
          !file.originalname.match(
            /\.(png|PNG|jpg|JPG|jpeg|JPEG|gif|GIF|mp4|MP4|mpeg-4|MPEG-4|mov|MOV)$/,
          )
        ) {
          return cb(new Error("Invalid file format"));
        }
        cb(undefined, true);
      },
    });

    // GET REQUESTS

    /**
     * Fetches all the ads from the database
     */
    app.get("/api/ads", async (req, res) => {
      try {
        // Retrieve the type parameter submitted in the url
        const type = req.query.type;

        // Fetch all ads from the database
        const ads = await req.db
          .collection("ads")
          .find({
            $and: [
              { endDate: { $gte: Date.now() } },
              { type: parseInt(type) },
              { $or: [{ active: { $exists: false } }, { active: true }] },
            ],
          })
          .sort({ startDate: 1 })
          .toArray();
        return res.status(200).json(ads);
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /**
     * Fetches all the ads created by me from the database
     */
    app.get("/api/ads/me", verifyJWT, async (req, res) => {
      try {
        const user = await req.db
          .collection("users")
          .findOne({ name: res.locals.user });
        // Retrieve the limit parameter submitted in the url
        const limit = req.query.limit ? parseInt(req.query.limit) : -1;

        let ads;
        if (limit >= 0) {
          ads = await req.db
            .collection("ads")
            .find({ user: user._id })
            .sort({ startDate: -1 })
            .limit(limit)
            .toArray();
        } else {
          ads = await req.db
            .collection("ads")
            .find({ user: user._id })
            .sort({ startDate: -1 })
            .toArray();
        }

        return res.status(200).json(ads);
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /**
     * Fetches a specific ad from the database by its id
     */
    app.get("/api/ad/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const objectId = ObjectId.isValid(id) ? new ObjectId(id) : null;

        if (!objectId) {
          // Handle the case when id is not a valid ObjectId
          return res.status(400).json({ error: "Invalid id format" });
        }

        const ad = await req.db.collection("ads").findOne({ _id: objectId });

        if (!ad) {
          return res.status(404).json({ error: "Ad not found" });
        }

        const now = new Date().getTime();

        const nextAd = await req.db
          .collection("ads")
          .find({
            startDate: { $gt: ad.startDate },
            endDate: { $gte: now },
            $or: [{ active: { $exists: false } }, { active: { $ne: false } }],
          })
          .sort({ startDate: 1 })
          .limit(1)
          .toArray();

        const previousAd = await req.db
          .collection("ads")
          .find({
            startDate: { $lt: ad.startDate },
            endDate: { $gte: now },
            $or: [{ active: { $exists: false } }, { active: { $ne: false } }],
          })
          .sort({ startDate: -1 })
          .limit(1)
          .toArray();

        const result = {
          ad,
          nextAd: nextAd.length > 0 ? nextAd[0] : null,
          previousAd: previousAd.length > 0 ? previousAd[0] : null,
        };

        return res.status(200).json(result);
      } catch (err) {
        return res.status(500).json({ error: "Server error" });
      }
    });

    /**
     * Fetches all the ads to verify from the database
     */
    app.get("/api/ads/pending", verifyJWT, async (req, res) => {
      try {
        // Fetch all ads to verify from the database
        const ads = await req.db
          .collection("ads")
          .find({ endDate: { $exists: false } })
          .sort({ startDate: -1 })
          .toArray();

        return res.status(200).json(ads);
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /** Fetches all the premium ads from the database */
    app.get("/api/ads/premium", async (req, res) => {
      try {
        // Retrieve the type parameter submitted in the url
        const type = req.query.type;

        // Fetch all premium ads from the database
        const ads = await req.db
          .collection("ads")
          .find({
            $and: [
              { endDate: { $gte: Date.now() } },
              { type: parseInt(type) },
              { premiumEndDate: { $gte: Date.now() } },
              { $or: [{ active: { $exists: false } }, { active: true }] },
            ],
          })
          .toArray();

        return res.status(200).json(ads);
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /**
     * Fetches all the favorite ads of the user from the database
     */
    app.get("/api/favorites", verifyJWT, async (req, res) => {
      try {
        // Retrieve the user
        const user = await req.db
          .collection("users")
          .findOne({ name: res.locals.user });

        // Check if the user has favorites
        if (user.favorites.length === 0) return res.status(200).json([]);

        // Fetch all favorites of the user from the database
        const ads = await req.db
          .collection("ads")
          .find({ _id: { $in: user.favorites } })
          .toArray();

        return res.status(200).json(ads);
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /**
     * Fetches all the subscribed ads of the user from the database
     */
    app.get("/api/subs", verifyJWT, async (req, res) => {
      try {
        // Retrieve the user
        const user = await req.db
          .collection("users")
          .findOne({ name: res.locals.user });

        // Fetch all subscriptions of the user from the database
        const ads = await req.db
          .collection("ads")
          .find({ user: { $in: user.subscriptions } })
          .toArray();

        return res.status(200).json(ads);
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /**
     * Fetches all the attributes from the database
     */
    app.get("/api/attributes", async (req, res) => {
      // Retrieve the language parameter submitted in the url
      const language = req.query.lang;

      // Fetch all translated attributes from the database
      const attributes = await req.db
        .collection("attributes")
        .find({
          $or: [
            { name: "types" },
            { language },
            { name: "areaCodes" },
            { name: "durations" },
          ],
        })
        .toArray();

      return res.status(200).json(attributes);
    });

    /**
     * Fetches all the available prices from stripe
     */
    app.get("/pay/prices", verifyJWT, async (req, res) => {
      try {
        // Retrieve the currency parameter submitted in the url
        const currency = req.query.currency;
        const prices = await stripe.prices.list({
          active: true,
          currency,
          product: process.env.STRIPE_PRODUCT_KEY,
        });

        return res.status(200).json(prices.data);
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /**
     * Fetches the payment session from stripe
     */
    app.get("/pay", verifyJWT, async (req, res) => {
      try {
        // Retrieve the session id parameter submitted in the url
        const id = req.query.id;
        const session = await stripe.checkout.sessions.retrieve(id);

        return res.status(200).json({ session });
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /**
     * Fetches the payment session from payrexx
     */
    app.get("/pay/twint", verifyJWT, async (req, res) => {
      try {
        // Retrieve the session id parameter submitted in the url
        const id = req.query.id;

        // Retrieve the transaction from payrexx
        const options = {
          method: "GET",
          url: `https://api.payrexx.com/v1.0/Transaction/${id}/`,
          headers: { accept: "application/json" },
        };
        axios
          .request(options)
          .then(function (response) {
            console.log(response.data);
          })
          .catch(function (error) {
            console.error(error);
          });

        // Validate payment
        res.status(200);
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /**
     * Fetches all the messages addressed to the user
     */
    app.get("/api/messages", verifyJWT, async (req, res) => {
      try {
        // Retrieve the user
        const user = await req.db
          .collection("users")
          .findOne({ name: res.locals.user });
        // Retrieve the limit parameter submitted in the url
        const limit = req.query.limit ? parseInt(req.query.limit) : -1;

        let messages;
        // Fetches all the messages from the database addressed to me
        if (limit >= 0) {
          messages = await req.db
            .collection("messages")
            .aggregate([
              { $match: { to: user._id } },
              {
                $lookup: {
                  from: "users",
                  localField: "from",
                  foreignField: "_id",
                  as: "from",
                },
              },
            ])
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
        } else {
          messages = await req.db
            .collection("messages")
            .aggregate([
              { $match: { $or: [{ from: user._id }, { to: user._id }] } },
              {
                $lookup: {
                  from: "users",
                  localField: "from",
                  foreignField: "_id",
                  as: "from",
                },
              },
              {
                $lookup: {
                  from: "users",
                  localField: "to",
                  foreignField: "_id",
                  as: "to",
                },
              },
            ])
            .sort({ timestamp: -1 })
            .toArray();
        }

        return res.status(200).json(messages);
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /** Fetches all the messages from a conversation with a user */
    app.get("/api/messages/:id", verifyJWT, async (req, res) => {
      try {
        // Retrieve the user
        const user = await req.db
          .collection("users")
          .findOne({ name: res.locals.user });
        // Retrieve the id parameter submitted in the url
        const id = req.params.id;
        const objectId = ObjectId.isValid(id) ? new ObjectId(id) : null;
        // Retrieve the limit parameter submitted in the url
        const limit = req.query.limit ? parseInt(req.query.limit) : -1;

        if (!objectId) {
          // Handle the case when id is not a valid ObjectId
          return res.status(400).json({ error: "Invalid id format" });
        }

        let messages;
        // Fetches all the messages from the conversation with the user from the database
        if (limit >= 0) {
          messages = await req.db
            .collection("messages")
            .aggregate([
              {
                $match: {
                  $or: [
                    { from: user._id, to: objectId },
                    { from: objectId, to: user._id },
                  ],
                },
              },
              {
                $lookup: {
                  from: "users",
                  localField: "from",
                  foreignField: "_id",
                  as: "from",
                },
              },
              {
                $lookup: {
                  from: "users",
                  localField: "to",
                  foreignField: "_id",
                  as: "to",
                },
              },
            ])
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
        } else {
          messages = await req.db
            .collection("messages")
            .aggregate([
              {
                $match: {
                  $or: [
                    { from: user._id, to: objectId },
                    { from: objectId, to: user._id },
                  ],
                },
              },
              {
                $lookup: {
                  from: "users",
                  localField: "from",
                  foreignField: "_id",
                  as: "from",
                },
              },
              {
                $lookup: {
                  from: "users",
                  localField: "to",
                  foreignField: "_id",
                  as: "to",
                },
              },
            ])
            .sort({ timestamp: -1 })
            .toArray();
        }

        return res.status(200).json(messages);
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /** Fetches all blog posts from the database */
    app.get("/api/blogs", async (req, res) => {
      try {
        // Fetch all blog posts from the database
        const blogs = await req.db
          .collection("blogs")
          .find({})
          .sort({ timestamp: -1 })
          .toArray();

        return res.status(200).json(blogs);
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /** Fetches all blog posts created by me from the database */
    app.get("/api/blogs/me", verifyJWT, async (req, res) => {
      try {
        // Retrieve the user
        const user = await req.db
          .collection("users")
          .findOne({ name: res.locals.user });

        // Fetch all blog posts created by me from the database
        const blogs = await req.db
          .collection("blogs")
          .find({ user: user._id })
          .sort({ timestamp: -1 })
          .toArray();

        return res.status(200).json(blogs);
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /** Fetch a specific blog post from the database by its id */
    app.get("/api/blog/:id", async (req, res) => {
      try {
        const id = req.params.id;

        // Check if id is valid ObjectId before querying
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid id format" });
        }

        // Convert the ID to an ObjectId
        const objectId = new ObjectId(id);

        // Fetch the blog post from the database
        const blog = await req.db
          .collection("blogs")
          .findOne({ _id: objectId });

        if (!blog) {
          return res.status(404).json({ error: "Blog not found" });
        }

        return res.status(200).json(blog);
      } catch (err) {
        return res.status(500).json({ error: "Server error" });
      }
    });

    // POST REQUESTS

    /**
     * Authenticates the user
     */
    app.post("/auth/login", async (req, res) => {
      // Get the object from the request body
      const obj = req.body;

      // Fetch the user from the database
      const user = await req.db.collection("users").findOne({
        $or: [
          { name: { $regex: `^${obj.name}$`, $options: "i" } },
          { email: obj.name },
        ],
      });

      // Check whether the username is valid
      if (!user) {
        return res
          .status(400)
          .json({ err: "Invalid username, email or password" });
      }

      // Check whether the user is verified
      if (!user.verified) {
        return res.status(400).json({ err: "Account is not verified" });
      }

      // Check whether the password is valid
      bcrypt.compare(obj.password, user.password).then((val) => {
        if (!val) {
          return res
            .status(400)
            .json({ err: "Invalid username, email or password" });
        }

        // Create the JWT token
        jwt.sign(
          { name: user.name, email: user.email },
          process.env.JWT_SECRET_KEY,
          { expiresIn: 86400 },
          (err, token) => {
            if (err) return res.status(500).json({ err });
            return res.status(200).json({
              token,
              user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                image: user.image,
              },
            });
          },
        );
      });
    });

    /**
     * Sign up a new user
     */
    app.post("/auth/signup", async (req, res) => {
      // Get the object from the request body
      const user = req.body;

      // Check whether the name is already taken
      if (
        await req.db.collection("users").findOne({
          name: { $regex: `^${user.name}$`, $options: "i" },
        })
      ) {
        return res.status(400).json({ err: "The username is already taken" });
      }

      // Check whether the email is already taken
      if (
        await req.db.collection("users").findOne({
          email: { $regex: `^${user.email}$`, $options: "i" },
        })
      ) {
        return res.status(400).json({ err: "The email is already taken" });
      }

      // Validate the password
      if (user.password !== user.password2) {
        return res.status(400).json({ err: "Unequal new passwords" });
      }

      // Hash the password of the user
      user.password = await bcrypt.hash(req.body.password, 10);

      // Insert the user to the database
      const item = await req.db.collection("users").insertOne(
        {
          name: user.name,
          email: user.email,
          password: user.password,
          image: null,
          credits: 0,
          favorites: [],
          subscriptions: [],
          verified: false,
        },
        (err, item) => {
          if (err) return res.status(500).json({ err });
        },
      );

      // Send the verification email
      const url = `${process.env.FRONTEND_URL}/verify?id=${item.insertedId}`;
      sendEmail(
        user.email,
        "Registrierung abschliessen",
        { name: user.name, url },
        "./templates/registerUser.handlebars",
      );

      return res.status(200).json({ ok: true });
    });

    /**
     * Check whether the user has a valid token
     */
    app.post("/auth", verifyJWT, async (req, res) => {
      try {
        // Retrieve the user
        const user = await req.db
          .collection("users")
          .findOne({ name: res.locals.user });
        return res.status(200).json({
          name: user.name,
          email: user.email,
          image: user.image,
          credits: user.credits,
          _id: user._id,
        });
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /**
     * Forgotten password request
     */
    app.post("/auth/forgotPassword", async (req, res) => {
      try {
        // Get the object from the request body
        const body = req.body;

        // Check whether the name exists
        const user = await req.db
          .collection("users")
          .findOne({ email: body.name });
        if (!user) {
          return res.status(400).json({ err: "The email does not exist" });
        }

        // Generate a random token
        const token = crypto.randomBytes(32).toString("hex");
        // Hash the token
        const hashedToken = await bcrypt.hash(token, 10);

        // Send the email
        const url = `${process.env.FRONTEND_URL}/resetPassword?token=${token}&id=${user._id}`;
        sendEmail(
          user.email,
          "Passwort zurücksetzen",
          { name: user.name, url },
          "./templates/forgotPassword.handlebars",
        );

        // Update the user with the token
        await req.db
          .collection("users")
          .updateOne(
            { _id: user._id },
            { $set: { resetPasswordToken: hashedToken } },
            (err, item) => {
              if (err) return res.status(500).json({ err });
            },
          );
        return res.status(200).json({ ok: true });
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /**
     * Reset the password
     */
    app.post("/auth/resetPassword", async (req, res) => {
      try {
        // Get the object from the request body
        const body = req.body;

        // Check whether the passwords are equal
        if (body.password !== body.password2) {
          return res.status(400).json({ err: "Unequal new passwords" });
        }

        // Check whether the user exists
        const user = await req.db
          .collection("users")
          .findOne({ _id: new ObjectId(body.id) });
        if (!user) {
          return res.status(400).json({ err: "The user does not exist" });
        }
        if (!user.resetPasswordToken) {
          return res.status(400).json({ err: "The token is not valid" });
        }

        // Check whether the token is valid
        const valid = await bcrypt.compare(body.token, user.resetPasswordToken);
        if (!valid) {
          return res.status(400).json({ err: "The token is not valid" });
        }

        // Remove the token
        await req.db
          .collection("users")
          .updateOne(
            { _id: user._id },
            { $unset: { resetPasswordToken: "" } },
            (err, item) => {
              if (err) return res.status(500).json({ err });
            },
          );

        // Hash the new password
        const password = await bcrypt.hash(body.password, 10);

        // Update the password
        await req.db
          .collection("users")
          .updateOne({ _id: user._id }, { $set: { password } }, (err, item) => {
            if (err) return res.status(500).json({ err });
            return res.status(200).json({ ok: true });
          });
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /**
     * Filter all the ads from the database
     */
    app.post("/api/filter/ads", async (req, res) => {
      // Get the object from the request body
      const filters = req.body;

      // Prepare the query for the database
      const query = {
        ...(filters.regions.length > 0
          ? { regions: { $in: filters.regions.map((region) => region) } }
          : false),
        ...(filters.tags.length > 0
          ? { tags: { $in: filters.tags.map((tag) => tag) } }
          : false),
        ...(filters.offers.length > 0
          ? { offers: { $in: filters.offers.map((offer) => offer) } }
          : false),
        ...(filters.search ? { $text: { $search: filters.search } } : false),
        ...{ endDate: { $gte: Date.now() } },
        ...{ type: filters.type },
        ...{ $or: [{ active: { $exists: false } }, { active: true }] },
        ...(filters.verified ? { verified: true } : false),
      };

      // Fetch the ads from the database
      const ads = await req.db
        .collection("ads")
        .find(query)
        .sort({ startDate: 1 })
        .toArray();

      return res.status(200).json(ads);
    });

    /**
     * Create a new add
     */
    app.post(
      "/api/ad",
      [
        verifyJWT,
        upload.fields([
          { name: "image", maxCount: 8 },
          { name: "video", maxCount: 1 },
          { name: "verificationImage", maxCount: 1 },
        ]),
      ],
      async (req, res) => {
        // Get the object from the request body
        const ad = JSON.parse(req.body.ad);

        try {
          const user = await req.db
            .collection("users")
            .findOne({ name: res.locals.user });
          const durations = await req.db
            .collection("attributes")
            .findOne({ name: "durations" });
          const duration = durations.values[ad.duration];

          // Calculate the total credits
          const cDuration = duration.credits;
          const cTags = ad.tags.length > 0 ? (ad.tags.length - 1) * 10 : 0;
          const cRegions =
            ad.regions.length > 0 ? (ad.regions.length - 1) * 10 : 0;
          const cTotal = cDuration + cTags + cRegions;
          // Check the credit score of the user
          if (user.credits < cTotal) {
            return res.status(400).json({ err: "The credit score is too low" });
          }

          // Modify the ad for the database
          if (!req.files || (req.files && !req.files.verificationImage)) {
            delete ad.duration;
          }
          ad.user = user._id;
          ad.startDate = Date.now();
          ad.endDate = Date.now() + duration.duration * 24 * 60 * 60 * 1000;
          // Properly reference the files
          if (req.files && req.files.image) {
            req.files.image.map((image, i) => (ad.images[i] = image.path));
          }
          if (req.files && req.files.video) ad.video = req.files.video[0].path;
          if (req.files && req.files.verificationImage) {
            delete ad.endDate;
            ad.verificationImage = req.files.verificationImage[0].path;
          }

          // Insert the ad to the database
          await req.db.collection("ads").insertOne(ad, async (err, item) => {
            if (err) return res.status(500).json({ err });
          });

          // Update the credits of the user
          await req.db
            .collection("users")
            .updateOne(
              { name: user.name },
              { $set: { credits: user.credits - cTotal } },
              (err, item) => {
                if (err) return res.status(500).json({ err });
              },
            );

          return res.status(200).json({ ok: true, usedCredits: cTotal });
        } catch (err) {
          return res.status(500).json({ err });
        }
      },
    );

    /**
     * Do payment via stripe
     */
    app.post("/pay/checkout", verifyJWT, async (req, res) => {
      try {
        // Get the price id from the request body
        const id = req.body.id;

        // Create the checkout session
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price: id,
              quantity: 1,
            },
          ],
          metadata: {
            user_name: res.locals.user,
          },
          mode: "payment",
          success_url: `${process.env.FRONTEND_URL}/admin/pay/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.FRONTEND_URL}/admin/credits`,
        });

        return res.status(200).json({ url: session.url });
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /**
     * Do payment via twint
     */
    app.post("/pay/twint/checkout", verifyJWT, async (req, res) => {
      try {
        // Get the price from the request body
        const price = req.body;
        // Retrive the user
        const user = await req.db
          .collection("users")
          .findOne({ name: res.locals.user });

        // Create a reference id
        const refId = crypto.randomBytes(16).toString("hex");

        // Initialize the payrexx session
        const prexx = payrexx.init(
          process.env.PAYREXX_INSTANCE_NAME,
          process.env.PAYREXX_SECRET_KEY,
        );

        // Create the checkout session
        const response = await prexx.createPaylink({
          title: "Paylink",
          description: "",
          referenceId: refId,
          purpose: `${price.nickname.replace(
            /\s/g,
            "-",
          )}-[${price.currency.toUpperCase()}]`,
          amount: price.unit_amount,
          currency: price.currency.toUpperCase(),
          "fields[email][defaultValue]": user.email,
          successRedirectUrl: `${process.env.FRONTEND_URL}/admin/pay/twint/success?amount=${price.unit_amount}`,
          failedRedirectUrl: `${process.env.FRONTEND_URL}/admin/credits`,
        });

        if (response.status === 200) {
          return res.status(200).json({ url: response.data.data[0].link });
        }
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /**
     * Send message
     */
    app.post("/api/message", verifyJWT, async (req, res) => {
      try {
        // Retrieve the fromUser
        const fromUser = await req.db
          .collection("users")
          .findOne({ name: res.locals.user });
        // Retrieve the message
        const message = req.body.message;
        // Retrieve the toUser
        const objectId = ObjectId.isValid(req.body.user)
          ? new ObjectId(req.body.user)
          : null;
        const toUser = await req.db
          .collection("users")
          .findOne({ _id: objectId });

        // Insert new message to database
        await req.db.collection("messages").insertOne(
          {
            message,
            timestamp: Date.now(),
            from: fromUser._id,
            to: toUser._id,
          },
          (err, item) => {
            if (err) return res.status(500).json({ err });
          },
        );
        return res.status(200).json({ ok: true });
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    // Create a new blog post
    app.post(
      "/api/blog",
      [verifyJWT, upload.fields([{ name: "image", maxCount: 8 }])],
      async (req, res) => {
        try {
          // Retrieve the user
          const user = await req.db
            .collection("users")
            .findOne({ name: res.locals.user });
          // Retrieve the blog post
          const blog = JSON.parse(req.body.blog);

          // Modify the blog post for the database
          blog.user = user._id;
          blog.timestamp = Date.now();

          if (req.files && req.files.image) {
            blog.images = [];
            req.files.image.map((image, i) => blog.images.push(image.path));
          }

          // Insert the blog post to the database
          await req.db.collection("blogs").insertOne(blog, (err, item) => {
            if (err) return res.status(500).json({ err });
            return res.status(200).json({ ok: true });
          });
        } catch (err) {
          return res.status(500).json({ err });
        }
      },
    );

    // PUT REQUESTS

    /**
     * Updates the attributes of the user
     */
    app.put(
      "/api/user",
      [verifyJWT, upload.single("image")],
      async (req, res) => {
        try {
          // Retrieve the user
          const user = await req.db
            .collection("users")
            .findOne({ name: res.locals.user });
          // Retrieve the attributes
          const attributes = JSON.parse(req.body.user);
          // Update all the attributes
          if (attributes.name !== user.name) {
            // Check whether the name is already taken
            if (
              await req.db
                .collection("users")
                .findOne({ name: attributes.name })
            ) {
              return res
                .status(400)
                .json({ err: "The username is already taken" });
            }
            user.name = attributes.name;
          }
          if (attributes.email !== user.email) user.email = attributes.email;
          if (req.file) user.image = req.file.path;
          if (
            attributes.currentPassword &&
            attributes.password &&
            attributes.password2
          ) {
            // Check whether the password is valid
            if (
              !(await bcrypt.compare(attributes.currentPassword, user.password))
            ) {
              return res.status(400).json({ err: "Invalid current password" });
            }

            // Validate the new password
            if (attributes.password !== attributes.password2) {
              return res.status(400).json({ err: "Unequal new passwords" });
            }

            user.password = await bcrypt.hash(attributes.password, 10);
          }
          // Update the attributes
          await req.db
            .collection("users")
            .replaceOne({ _id: user._id }, user, (err, item) => {
              if (err) return res.status(500).json({ err });
            });
          // Create the new JWT token
          jwt.sign(
            { name: user.name, email: user.email },
            process.env.JWT_SECRET_KEY,
            { expiresIn: 86400 },
            (err, token) => {
              if (err) return res.status(500).json({ err });
              return res.status(200).json({
                token,
                user: {
                  name: user.name,
                  email: user.email,
                  image: user.image,
                },
              });
            },
          );
        } catch (err) {
          return res.status(500).json({ err });
        }
      },
    );

    /** Updates the attributes of the ad */
    app.put(
      "/api/ad/:id",
      [
        verifyJWT,
        upload.fields([
          { name: "image", maxCount: 8 },
          { name: "video", maxCount: 1 },
        ]),
      ],
      async (req, res) => {
        try {
          // Validate ID before using it
          if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid ID format" });
          }

          // Convert the ID to an ObjectId
          const objectId = new ObjectId(req.params.id);

          // Retrieve the user
          const user = await req.db
            .collection("users")
            .findOne({ name: res.locals.user });

          // Retrieve the id of the ad
          const ad = await req.db.collection("ads").findOne({ _id: objectId });

          // Retrieve the new ad
          const newAd = JSON.parse(req.body.ad);

          // Calculate the total credits
          const cTags =
            newAd.tags.length - ad.tags.length > 0
              ? (newAd.tags.length - ad.tags.length) * 10
              : 0;
          const cRegions =
            newAd.regions.length - ad.regions.length > 0
              ? (newAd.regions.length - ad.regions.length) * 10
              : 0;
          const cTotal = cTags + cRegions;

          // Modify the new ad for the database
          delete newAd._id;
          newAd.user = ad.user;
          if (req.files && req.files.image) {
            req.files.image.map((image, i) => newAd.images.push(image.path));
          }
          newAd.images = newAd.images.filter(
            (image) => typeof image === "string",
          );
          if (req.files && req.files.video) {
            newAd.video = req.files.video[0].path;
          }
          if (req.files && req.files.verificationImage) {
            newAd.verificationImage = req.files.verificationImage[0].path;
          }

          // Check the credit score of the user
          if (user.credits < cTotal) {
            return res.status(400).json({ err: "The credit score is too low" });
          }

          // Update the ad in the database
          await req.db
            .collection("ads")
            .replaceOne({ _id: ad._id }, newAd, (err, item) => {
              if (err) return res.status(500).json({ err });

              newAd._id = ad._id;
            });

          // Remove the credits from the user in the database
          req.db
            .collection("users")
            .updateOne(
              { name: user.name },
              { $set: { credits: user.credits - cTotal } },
              (err, item) => {
                if (err) return res.status(500).json({ err });
              },
            );

          return res.status(200).json({ ad: newAd });
        } catch (err) {
          return res.status(500).json({ err });
        }
      },
    );

    /**
     * Update the favorite ads of the user
     */
    app.put("/api/favorites/:id", verifyJWT, async (req, res) => {
      try {
        // Get the ad id from the request url
        const id = req.params.id;

        // Check if id is valid ObjectId before querying
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid id format" });
        }

        // Convert the ID to an ObjectId
        const objectId = new ObjectId(id);
        // Retrieve the user
        const user = await req.db
          .collection("users")
          .findOne({ name: res.locals.user });
        const favorites = user.favorites.map((favorite) => favorite.toString());

        // Add or remove the ad from the favorites
        const i = favorites.indexOf(id);
        if (i === -1) user.favorites.push(objectId);
        else user.favorites.splice(i, 1);

        // Update the favorites
        await req.db
          .collection("users")
          .updateOne(
            { _id: user._id },
            { $set: { favorites: user.favorites } },
            (err, item) => {
              if (err) return res.status(500).json({ err });
              return res.status(200).json({ ok: true });
            },
          );
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /**
     * Update the subscriptions of the user
     */
    app.put("/api/subs/:id", verifyJWT, async (req, res) => {
      try {
        // Get the user id from the request url
        const id = req.params.id;
        // Retrieve the user
        const user = await req.db
          .collection("users")
          .findOne({ name: res.locals.user });
        const subscriptions = user.subscriptions.map((sub) => sub.toString());

        // Add or remove the ad from the favorites
        const i = subscriptions.indexOf(id);
        if (i === -1) user.subscriptions.push(ObjectId(id));
        else user.subscriptions.splice(i, 1);

        // Update the subscriptions
        await req.db
          .collection("users")
          .updateOne(
            { _id: user._id },
            { $set: { subscriptions: user.subscriptions } },
            (err, item) => {
              if (err) return res.status(500).json({ err });
              return res.status(200).json({ ok: true });
            },
          );
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /** Verifies the user */
    app.put("/api/user/verify/:id", async (req, res) => {
      try {
        // Get the ad id from the request url
        const id = req.params.id;

        // Check if id is valid ObjectId before querying
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid id format" });
        }

        // Convert the ID to an ObjectId
        const objectId = new ObjectId(id);

        // Retrieve the user
        const user = await req.db
          .collection("users")
          .findOne({ _id: objectId });

        // Check whether the user exists
        if (!user) return res.status(400).json({ err: "User does not exist" });

        // Check whether the user is already verified
        if (user.verified) {
          return res.status(400).json({ err: "User is already verified" });
        }

        // Modify the user for the database
        user.verified = true;

        // Update the user
        await req.db
          .collection("users")
          .replaceOne({ _id: user._id }, user, (err, item) => {
            if (err) return res.status(500).json({ err });
          });

        return res.status(200).json({ ok: true });
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /** Verifies the ad */
    app.put("/api/ad/verify/:id", verifyJWT, async (req, res) => {
      try {
        const objectId = ObjectId.isValid(req.params.id)
          ? new ObjectId(req.params.id)
          : null;

        // Retrieve the ad
        const ad = await req.db.collection("ads").findOne({ _id: objectId });

        // Handle if ad not found
        if (!ad) {
          return res.status(404).json({ err: "Ad not found" });
        }

        // Retrieve the duration
        const durations = await req.db
          .collection("attributes")
          .findOne({ name: "durations" });
        const duration = durations.values[ad.duration];

        // Modify the ad for the database
        delete ad.duration;
        ad.startDate = Date.now();
        ad.endDate = Date.now() + duration.duration * 24 * 60 * 60 * 1000;
        ad.verified = true;

        // Update the ad
        await req.db
          .collection("ads")
          .replaceOne({ _id: ad._id }, ad, (err, item) => {
            if (err) return res.status(500).json({ err });
          });

        // Send an email to the user
        const user = await req.db.collection("users").findOne({ _id: ad.user });
        sendEmail(
          user.email,
          "Verifizierung",
          { name: user.name },
          "./templates/verifiedAd.handlebars",
        );

        return res.status(200).json({ ok: true });
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /** Deactivate an ad */
    app.put("/api/ad/deactivate/:id", verifyJWT, async (req, res) => {
      try {
        const objectId = ObjectId.isValid(req.params.id)
          ? new ObjectId(req.params.id)
          : null;

        // Retrieve the ad
        const ad = await req.db.collection("ads").findOne({ _id: objectId });

        // Handle if ad not found
        if (!ad) {
          return res.status(404).json({ error: "Ad not found" });
        }

        // Update the ad
        await req.db
          .collection("ads")
          .updateOne(
            { _id: ad._id },
            { $set: { active: false } },
            (err, item) => {
              if (err) return res.status(500).json({ err });
              return res.status(200).json({ ok: true });
            },
          );
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /** Activate an ad */
    app.put("/api/ad/activate/:id", verifyJWT, async (req, res) => {
      try {
        const objectId = ObjectId.isValid(req.params.id)
          ? new ObjectId(req.params.id)
          : null;

        // Retrieve the ad
        const ad = await req.db.collection("ads").findOne({ _id: objectId });

        // Handle if ad not found
        if (!ad) {
          return res.status(404).json({ error: "Ad not found" });
        }

        // Update the ad
        await req.db
          .collection("ads")
          .updateOne(
            { _id: ad._id },
            { $set: { active: true } },
            (err, item) => {
              if (err) return res.status(500).json({ err });
              return res.status(200).json({ ok: true });
            },
          );
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /** Set an ad as premium for the day */
    app.put("/api/ad/premium/:id", verifyJWT, async (req, res) => {
      try {
        const objectId = ObjectId.isValid(req.params.id)
          ? new ObjectId(req.params.id)
          : null;

        // Retrieve the ad
        const ad = await req.db.collection("ads").findOne({ _id: objectId });

        // Handle if ad not found
        if (!ad) {
          return res.status(404).json({ error: "Ad not found" });
        }

        // Retrieve the user
        const user = await req.db
          .collection("users")
          .findOne({ name: res.locals.user });

        // Check if the user has enough credits
        if (user.credits < 30) {
          return res.status(400).json({ err: "Not enough credits" });
        }

        // Check if the ad is already premium
        if (ad.premiumEndDate && ad.premiumEndDate > Date.now()) {
          return res.status(400).json({ err: "Ad is already premium" });
        }

        // Check if there are already 4 premium ads
        const premiumAds = await req.db.collection("ads").find({
          premiumEndDate: { $gt: Date.now() },
        });
        if (premiumAds.length >= 4) {
          return res.status(400).json({ err: "Too many premium ads" });
        }

        // Update the ad
        await req.db
          .collection("ads")
          .updateOne(
            { _id: ad._id },
            { $set: { premiumEndDate: Date.now() + 24 * 60 * 60 * 1000 } },
            (err, item) => {
              if (err) return res.status(500).json({ err });
            },
          );

        // Update the credits of the user
        await req.db
          .collection("users")
          .updateOne(
            { _id: user._id },
            { $set: { credits: user.credits - 30 } },
            (err, item) => {
              if (err) return res.status(500).json({ err });
            },
          );

        return res.status(200).json({ ok: true });
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /** Boost the ad to the top of the list */
    app.put("/api/ad/boost/:id", verifyJWT, async (req, res) => {
      try {
        const objectId = ObjectId.isValid(req.params.id)
          ? new ObjectId(req.params.id)
          : null;

        // Retrieve the ad
        const ad = await req.db.collection("ads").findOne({ _id: objectId });

        // Handle if ad not found
        if (!ad) {
          return res.status(404).json({ error: "Ad not found" });
        }

        // Retrieve the user
        const user = await req.db
          .collection("users")
          .findOne({ name: res.locals.user });

        // Check if the user has enough credits
        if (user.credits < 5) {
          return res.status(400).json({ err: "Not enough credits" });
        }

        // Update the ad
        await req.db
          .collection("ads")
          .updateOne(
            { _id: ad._id },
            { $set: { startDate: Date.now() } },
            (err, item) => {
              if (err) return res.status(500).json({ err });
            },
          );

        // Update the credits of the user
        await req.db
          .collection("users")
          .updateOne(
            { _id: user._id },
            { $set: { credits: user.credits - 5 } },
            (err, item) => {
              if (err) return res.status(500).json({ err });
            },
          );
        return res.status(200).json({ ok: true });
      } catch (err) {
        return res.status(500).json({ err });
      }
    });

    /**
     * Reactivate the ad
     */
    app.put(
      "/api/ad/reactivate/:id/:durationId",
      verifyJWT,
      async (req, res) => {
        try {
          const objectId = ObjectId.isValid(req.params.id)
            ? new ObjectId(req.params.id)
            : null;

          // Retrieve the ad
          const ad = await req.db.collection("ads").findOne({ _id: objectId });

          // Handle if ad not found
          if (!ad) {
            return res.status(404).json({ error: "Ad not found" });
          }

          // Retrieve the user
          const user = await req.db
            .collection("users")
            .findOne({ name: res.locals.user });

          // Retrieve the duration
          const durations = await req.db
            .collection("attributes")
            .findOne({ name: "durations" });
          const duration = durations.values[req.params.durationId];

          // Calculate the total credits
          const cDuration = duration.credits;
          const cTags = ad.tags.length > 0 ? (ad.tags.length - 1) * 10 : 0;
          const cRegions =
            ad.regions.length > 0 ? (ad.regions.length - 1) * 10 : 0;
          const cTotal = cDuration + cTags + cRegions;

          // Check the credit score of the user
          if (user.credits < cTotal) {
            return res.status(400).json({ err: "The credit score is too low" });
          }

          // Update the ad's startDate and endDate in the database
          const startDate = Date.now();
          const endDate = startDate + duration.duration * 24 * 60 * 60 * 1000;
          await req.db
            .collection("ads")
            .updateOne({ _id: ad._id }, { $set: { startDate, endDate } });

          // Deduct the credits from the user's account
          await req.db
            .collection("users")
            .updateOne(
              { name: user.name },
              { $set: { credits: user.credits - cTotal } },
            );

          return res.status(200).json({ ok: true });
        } catch (err) {
          return res.status(500).json({ err });
        }
      },
    );

    /** Updates the attributes of a blog post */
    app.put(
      "/api/blog/:id",
      [verifyJWT, upload.fields([{ name: "image", maxCount: 8 }])],
      async (req, res) => {
        try {
          // Validate ID before using it
          if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid ID format" });
          }

          // Convert the ID to an ObjectId
          const objectId = new ObjectId(req.params.id);

          // Retrieve the blog post
          const blog = await req.db
            .collection("blogs")
            .findOne({ _id: objectId });

          if (!blog) {
            return res.status(404).json({ error: "Blog post not found" });
          }

          // Retrieve the new blog post
          const newBlog = JSON.parse(req.body.blog);

          newBlog.timestamp = Date.now();

          // Modify the new blog post for the database
          delete newBlog._id;
          newBlog.user = blog.user;

          if (req.files && req.files.image) {
            newBlog.images = [];
            req.files.image.map((image, i) => newBlog.images.push(image.path));
          }

          // Update the blog post in the database
          await req.db
            .collection("blogs")
            .replaceOne({ _id: objectId }, newBlog, (err, item) => {
              if (err) return res.status(500).json({ err });

              newBlog._id = objectId;
              return res.status(200).json({ blog: newBlog });
            });
        } catch (err) {
          return res.status(500).json({ err });
        }
      },
    );

    app.delete("/api/ad/delete/:id", verifyJWT, async (req, res) => {
      try {
        const objectId = ObjectId.isValid(req.params.id)
          ? new ObjectId(req.params.id)
          : null;

        // Retrieve the ad
        const ad = await req.db.collection("ads").findOne({ _id: objectId });

        // Handle if ad not found
        if (!ad) {
          return res.status(404).json({ error: "Ad not found" });
        }

        // Retrieve the user
        const user = await req.db.collection("users").findOne({ _id: ad.user });

        // Remove the ad from the database
        const result = await req.db
          .collection("ads")
          .deleteOne({ _id: objectId });

        if (result.deletedCount === 1) {
          // Send an email to the user
          sendEmail(
            user.email,
            "Verifizierung abgelehnt",
            { name: user.name, ad },
            "./templates/declinedAd.handlebars",
          );

          return res.status(200).json({ ok: true });
        } else {
          return res.status(404).json({ error: "Ad not found" });
        }
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    });

    /** Delete a blog post */
    app.delete("/api/blog/delete/:id", verifyJWT, async (req, res) => {
      try {
        const id = req.params.id;

        // Check if id is valid ObjectId before querying
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid id format" });
        }

        // Convert the ID to an ObjectId
        const objectId = new ObjectId(id);

        // Delete the blog post from the database
        await req.db
          .collection("blogs")
          .deleteOne({ _id: objectId }, (err, item) => {
            if (err) return res.status(500).json({ err });
            return res.status(200).json({ ok: true });
          });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    });

    // Webhooks

    app.post("/pay/webhook", async (req, res) => {
      // Verify the event
      const signature = req.headers["stripe-signature"];

      try {
        // Retrieve the event
        const event = stripe.webhooks.constructEvent(
          req.rawBody,
          signature,
          process.env.STRIPE_SECRET_WEBHOOK_KEY,
        );

        // Handle the event
        switch (event.type) {
          case "checkout.session.completed": {
            // Retrieve the payment intend
            const paymentIntent = event.data.object;

            // Update the credits of the user in the database
            await req.db
              .collection("users")
              .updateOne(
                { name: paymentIntent.metadata.user_name },
                { $inc: { credits: paymentIntent.amount_total / 100 } },
                (err, item) => {
                  if (err) return res.status(500).json({ err });
                },
              );
            break;
          }
          default:
            // Unexpected event type
            console.log(`Unhandled event type ${event.type}.`);
        }

        return res.status(200).json({ ok: true });
      } catch (err) {
        // Failed verification
        console.log(
          "⚠️  Stripe-Webhook signature verification failed.",
          err.message,
        );
        return res.status(500).json({ err });
      }
    });

    app.post("/pay/twint/webhook", async (req, res) => {
      try {
        // Retrive the body
        const body = req.body;
        // Retrieve the event
        const event = body.transaction;

        // Handle the event
        switch (event.status) {
          case "confirmed": {
            // Retrieve the invoice
            const invoice = event.invoice;
            // Retrive the contact
            const contact = event.contact;

            // Update the credits of the user in the database
            await req.db
              .collection("users")
              .updateOne(
                { email: contact.email },
                { $inc: { credits: invoice.originalAmount / 100 } },
                (err, item) => {
                  if (err) {
                    return console.log(
                      "⚠️  Adding credits to user failed",
                      err,
                    );
                  }
                },
              );
            break;
          }
          case "waiting":
            console.log("waiting");
            break;
          default:
            // Unexpected event type
            console.log(`Unhandled event type ${event.status}.`);
        }
      } catch (err) {
        // Failed verification
        console.log("⚠️  TWINT-Webhook failed.", err.message);
      }
    });

    // Handle Next.js routing
    app.all("*", (req, res) => {
      return handle(req, res);
    });

    // Listen on port
    app.listen(SERVER_PORT, "127.0.0.1", () => {
      console.log(`Server listening on ${SERVER_PORT}`);
    });
  })
  .catch((ex) => {
    console.error(ex.stack);
    process.exit(1);
  });
