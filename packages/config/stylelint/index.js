// F-4: stylelint for the web app's CSS (D-38). Physical properties are errors; a declaration that
// must stay physical is preceded by
// `/* stylelint-disable-next-line csstools/use-logical -- rtl-exempt: <reason> */`.
export default {
  plugins: ["stylelint-use-logical"],
  rules: {
    "csstools/use-logical": ["always", { except: [] }],
  },
};
