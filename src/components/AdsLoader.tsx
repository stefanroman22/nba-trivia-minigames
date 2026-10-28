"use client";
import { useEffect } from "react";

const SCRIPT_ID = "sq-adsbygoogle";

/** Loads Google's AdSense tag (which carries Google's privacy message) once per page load. The root layout
 *  mounts it only when NEXT_PUBLIC_ADS_ENABLED is "true" and a publisher id is set, so with the flag off
 *  (the production default) neither this chunk nor any Google request exists. Renders nothing: ad slots are
 *  the AdSense set-up ticket's, and the non-personalised flag below is already set whenever slots are added. */
export default function AdsLoader({ pubId }: { pubId: string }) {
  useEffect(() => {
    // Non-personalised ads for everyone, every country, guests and accounts (owner decision Q1, 2026-10-27:
    // no age data and a young audience, EU GDPR Recital 38 / UK Children's Code). It must be set BEFORE the
    // tag exists, so the very first ad request already carries it.
    const ads: NonNullable<Window["adsbygoogle"]> = window.adsbygoogle || [];
    ads.requestNonPersonalizedAds = 1;
    window.adsbygoogle = ads;
    // The footer's "Privacy and cookie settings" button queues Google's revocation message here.
    const fc: NonNullable<Window["googlefc"]> = window.googlefc || {};
    fc.callbackQueue = fc.callbackQueue || [];
    window.googlefc = fc;
    // The layout survives route changes, but guard anyway so the tag is never added twice.
    if (document.getElementById(SCRIPT_ID)) return;
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(pubId)}`;
    document.head.appendChild(script);
  }, [pubId]);
  return null;
}
