// F-200: the application entry. The S-11a scaffold mounts an empty shell; S-11b builds the
// providers, router and Sentry set-up here.
import { render } from "solid-js/web";
import "./index.css";

function App() {
  return <main />;
}

const root = document.getElementById("root");
if (root !== null) render(() => <App />, root);
