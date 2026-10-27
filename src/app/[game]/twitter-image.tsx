export { default, alt, size, contentType, generateStaticParams } from "./opengraph-image";
// Only catalogued slugs are rendered (prebuilt); any other slug is a 404, never an on-demand PNG.
export const dynamicParams = false;
