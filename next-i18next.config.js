module.exports = {
  i18n: {
    defaultLocale: "de",
    locales: ["en", "de"],
  },
  localePath:
    typeof window === "undefined"
      ? require("path").resolve("./public/locales")
      : "/locales",
  reloadOnPrerender: process.env.NODE_ENV === "development",
};
