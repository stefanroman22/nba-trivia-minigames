"use client";
import Navigation from "./Navigation";

/** The site header on the server-rendered legal pages (Navigation needs the browser: Redux, modals,
 *  the profile menu), so /privacy and /terms feel part of the app rather than a dead end. */
export default function LegalHeader() {
  return <Navigation type="back" />;
}
