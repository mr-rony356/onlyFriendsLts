import React, { useEffect, useState } from "react";
import BlogCreate from "@pages/blog";
import ApiController, { API_ADDRESS } from "@utils/API";
import Head from "next/head";
import Image from "next/image";
import { useRouter } from "next/router";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";

export async function getServerSideProps({ params, req, locale }) {
  // Initialize the API helper class
  const api = new ApiController();
  // Fetch the slug
  const { id } = params;
  // Authenticate the user
  const auth = req.cookies.Auth ? JSON.parse(req.cookies.Auth) : "";
  const user = await api.checkAuth(auth.token);
  // Fetch all props server side
  const blog = await api.fetchBlog(id);
  // Return all props to the page
  return {
    props: {
      ...(await serverSideTranslations(locale, ["common", "footer"], null, [
        "en",
        "de",
      ])),
      user,
      blog,
    },
  };
}

const BlogDetail = ({ blog, user }) => {
  const [pastTime, setPastTime] = useState("");
  const [editMode, setEditMode] = useState(false);
  const router = useRouter();

  const creationDate = blog ? blog.timestamp : "";

  const currentDate = new Date();
  const timeDifference = currentDate - new Date(creationDate);

  const seconds = Math.floor((timeDifference / 1000) % 60);
  const hours = Math.floor((timeDifference / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((timeDifference / (1000 * 60)) % 60);
  const days = Math.floor(timeDifference / (1000 * 60 * 60 * 24));

  useEffect(() => {
    let pastTime = "";
    if (days) {
      pastTime += "vor " + days + (days === 1 ? " Tag" : " Tagen");
    } else if (hours) {
      pastTime += "vor " + hours + (hours === 1 ? " Stunde" : " Stunden");
    } else if (minutes) {
      pastTime += "vor " + minutes + (minutes === 1 ? " Minute" : " Minuten");
    } else {
      pastTime += "vor " + seconds + (seconds === 1 ? " Sekunde" : " Sekunden");
    }
    setPastTime(pastTime);
  }, [hours, minutes, days, seconds]);

  if (!blog) return <div>Loading...</div>;

  return (
    <>
      <Head>
        <title>OnlyFriend</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#000000" />
        <meta name="description" content="Onlyfriend" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </Head>

      <div className="blog-detail page">
        <div className="blog-detail__navigation">
          <Image
            src="/assets/menue.png"
            width={500}
            height={500}
            alt="arrow"
            className="blogDetail__homeIcon"
            loading="lazy"
            onClick={() => router.push("/blogs")}
          />
          {user && user.email === "cyrill.mueller@onlyfriend.ch" && (
            <Image
              src="/assets/editing.png"
              width={500}
              height={500}
              alt="edit"
              className="delete-icon"
              loading="lazy"
              onClick={() => setEditMode(!editMode)}
            />
          )}
        </div>
        {editMode ? (
          <BlogCreate editMode={editMode} blog={blog} />
        ) : (
          <>
            <Image
              src={
                blog.images &&
                blog.images.length > 0 &&
                API_ADDRESS + blog.images[0]
              }
              width={500}
              height={500}
              alt={blog.title}
              className="blog-image"
            />
            <div className="blog-details">
              <div className="blog-details__titleTime">
                <h1 className="blog-title">{blog.title}</h1>
                <p className="blog-details__time">{pastTime}</p>
              </div>
              <pre className="blog-text">{blog.text}</pre>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default BlogDetail;
