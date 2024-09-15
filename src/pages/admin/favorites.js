import React from "react";
import AdminLinks from "@components/admin/AdminLinks";
import Ad from "@components/home/Ad";
import { useApi } from "@contexts/APIContext";
import ApiController from "@utils/API";
import Head from "next/head";
import { useTranslation } from "next-i18next";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";

export async function getServerSideProps({ req, locale }) {
  // Initialize the API helper class
  const api = new ApiController();
  // Authenticate the user
  const auth = req.cookies.Auth ? JSON.parse(req.cookies.Auth) : "";
  const user = await api.checkAuth(auth.token);
  // Redirect the user if he is not authenticated
  if (!user || user.err) {
    return {
      redirect: {
        destination: "/login",
        permanent: false,
      },
    };
  }
  // Fetch all props server side
  const lang = locale === "de" ? "de" : "en";
  const attributes = await api.fetchAttributes(lang);
  const ads = await api.fetchFavorites(auth.token);
  // Return all props to the page
  return {
    props: {
      ...(await serverSideTranslations(locale, ["common", "footer"], null, [
        "en",
        "de",
      ])),
      user,
      attributes,
      ads,
    },
  };
}

const Favorites = ({ user, attributes, ads }) => {
  const { t } = useTranslation("common");
  const { api } = useApi();

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

      <div className="page">
        <h1 className="adminPage__activeUser">Hallo {user.name}</h1>

        <div className="adminPage__content">
          <AdminLinks user={user} />
          <div className="adminPage__contentComponents">
            <h1 className="title favorites--title">
              {t("admin__subscriptionsTitle")}
            </h1>
            <div className="favorites">
              {ads && ads.length < 0 ? (
                <p>{t("admin__subscriptionsTitle")}</p>
              ) : (
                ads &&
                ads.length > 0 &&
                ads.map((ad) => (
                  <div key={ad._id} className="favorite">
                    <Ad api={api} user={user} attributes={attributes} ad={ad} />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Favorites;
