import React, { useEffect, useState } from "react";
import FilterForm from "@components/forms/FilterForm";
import AdList from "@components/home/AdList";
import ApiController from "@utils/API";
import { generateMetaDesc, generateMetaTitle } from "@utils/MetaGenerators";
import Cookies from "js-cookie";
import Head from "next/head";
import Image from "next/image";
import { useTranslation } from "next-i18next";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";

export async function getServerSideProps({ req, locale, params }) {
  // Initialize the API helper class
  const api = new ApiController();
  // Fetch the slug
  const { slug } = params;
  // Authenticate the user
  const auth = req.cookies.Auth ? JSON.parse(req.cookies.Auth) : "";
  const user = await api.checkAuth(auth.token);
  // Parse the slug to form the initial filters
  const filters = slug.reduce(
    (acc, param, index) => {
      switch (param) {
        case "region":
          acc.regions = slug[index + 1].split(",").map((r) => parseInt(r));
          break;
        case "tag":
          acc.tags = slug[index + 1].split(",").map((t) => parseInt(t));
          break;
        case "offer":
          acc.offers = slug[index + 1].split(",").map((o) => parseInt(o));
          break;
        case "search":
          acc.search = slug[index + 1].replace(/[\s_-]+/g, " ");
          break;
        case "feature":
          acc.verified = slug[index + 1];
          break;
        case "type":
          acc.type = slug[index + 1].split(",").map((t) => parseInt(t));
          break;
        default:
          break;
      }
      return acc;
    },
    {
      regions: [],
      tags: [],
      offers: [],
      search: null,
      verified: false,
      type: 0,
    },
  );
  // Fetch all props server side
  const lang = locale === "de" ? "de" : "en";
  const attributes = await api.fetchAttributes(lang);
  const ads = await api.filterAds(filters);
  const premiumAds = await api.fetchPremiumAds(0);
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
      premiumAds,
      filters,
    },
  };
}

function HomePage({
  user,
  attributes,
  ads,
  premiumAds,
  filters: initialFilters,
}) {
  const { t } = useTranslation("common");
  const [filters, setFilters] = useState(initialFilters);
  const [isCookiesPopupOpen, setIsCookiesPopupOpen] = useState(false);
  const [isFilterVisible, setIsFilterVisible] = useState(false);
  const [activeType, setActiveType] = useState(0);

  useEffect(() => {
    const handleResize = () => {
      setIsFilterVisible(!window.matchMedia("(max-width: 820px)").matches);
    };

    handleResize();

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!Cookies.get("cookiesPopupShown")) {
      setIsCookiesPopupOpen(true);
      Cookies.set("cookiesPopupShown", true);
    }
  }, [isCookiesPopupOpen]);

  const toggleFilter = () => {
    setIsFilterVisible(!isFilterVisible);
  };

  let offers =
    initialFilters.offers.map(
      (o) => attributes.find((a) => a.name === "offers")?.values[o],
    ) ?? [];
  if (!offers.length)
    offers = attributes.find((a) => a.name === "offers")?.values;

  let locations =
    initialFilters.regions.map(
      (r) => attributes.find((a) => a.name === "regions")?.values[r],
    ) ?? [];
  if (!locations.length)
    locations = attributes.find((a) => a.name === "regions")?.values;

  return (
    <>
      <Head>
        <title>
          {generateMetaTitle(offers.join(", "), locations.join(", "))}
        </title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#000000" />
        <meta
          name="description"
          content="Entdecken Sie auf unserer Webseite erotische Anzeigen für Sexkontake und Onlyfans Accounts in der Schweiz. Treffen Sie heiße Girls in Ihrer Nähe und erleben Sie prickelnde Abenteuer. Ohne Anmeldung können Sie direkt mit den Girls in Kontakt kommen."
        />
        <meta
          name="keywords"
          content={
            generateMetaDesc(offers.join(", "), locations.join(", ")) +
            ", Onlyfans, Onlyfriends,"
          }
        />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </Head>

      <div className="page page--home">
        <h1 className="home__title">
          {t("home__title", {
            region: initialFilters.regions
              .map(
                (r) => attributes.find((a) => a.name === "regions")?.values[r],
              )
              .join(", "),
          })}
        </h1>
        <div className="home__content">
          <div className="home__left">
            {isFilterVisible && (
              <FilterForm
                filters={filters}
                setFilters={setFilters}
                attributes={attributes}
              />
            )}
          </div>
          <div className="home__right">
            <div className="button--inline">
              {attributes &&
                attributes.length > 0 &&
                attributes
                  .find((attribute) => attribute.name === "types")
                  .values.map((value) => (
                    <button
                      key={value.id}
                      className={
                        activeType === value.id ? "button" : "button inactive"
                      }
                      onClick={() => setActiveType(value.id)}
                    >
                      {value.name} {t("home__ad")}
                    </button>
                  ))}
              <img
                src={"/assets/filter.png"}
                width={100}
                height={100}
                alt="filter"
                className="filter"
                onClick={toggleFilter}
              />
            </div>
            <AdList
              user={user}
              className="home__ads"
              ads={ads}
              premiumAds={premiumAds}
              attributes={attributes}
            />
          </div>
        </div>
      </div>
    </>
  );
}

export default HomePage;
