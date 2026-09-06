import NoPageFound from "../views/NoPageFound";

/** Unknown paths (incl. non-catalogued game slugs) render the 404 page with a real 404 status. */
export default function NotFound() {
  return <NoPageFound />;
}
