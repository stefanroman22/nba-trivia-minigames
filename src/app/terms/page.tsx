import type { Metadata } from "next";
import LegalPage, { LegalHeading, LegalList, MailLink } from "../../components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The rules for using Swish Quest.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="7 October 2026">
      <p>
        By using Swish Quest (previously HOOPS24) you agree to these terms. If you do not agree, please do not use the
        site. Questions go to <MailLink />.
      </p>

      <LegalHeading>The service</LegalHeading>
      <p>
        Swish Quest is a free collection of NBA trivia games, with optional accounts, leaderboards, friends and online
        matches. It is provided as is. Games, points and features can change, pause or end at any time, and we do not
        promise the site will always be available or free of mistakes.
      </p>

      <LegalHeading>Your account</LegalHeading>
      <p>
        You must be at least 13. Keep your sign-in details to yourself and tell us if you think someone else has used your
        account. You are responsible for what happens under it. Points and ranks have no cash value.
      </p>

      <LegalHeading>Playing fair</LegalHeading>
      <LegalList>
        <li>Do not use offensive, hateful or impersonating names or photos. Names and photos are checked automatically, and repeated violations can lead to a ban.</li>
        <li>Do not cheat, script or automate play, farm points, or exploit bugs. Tell us about bugs instead.</li>
        <li>Do not attack, overload, scrape or try to break into the site or other players&apos; accounts.</li>
        <li>Do not harass other players in online matches.</li>
      </LegalList>
      <p>We may remove content, reset points, and suspend or ban accounts that break these rules, with or without notice.</p>

      <LegalHeading>Content and ownership</LegalHeading>
      <p>
        The site, its design and its code belong to us. NBA team and player names and related marks belong to their owners;
        Swish Quest is an independent fan project and is not affiliated with or endorsed by the NBA or any team. A photo you
        upload stays yours, and you allow us to display it on the site as part of your profile.
      </p>

      <LegalHeading>Liability</LegalHeading>
      <p>
        To the extent the law allows, we are not liable for indirect or consequential loss arising from your use of the
        site, and our total liability is limited to what you paid us, which is nothing. Nothing here limits rights you
        have by law that cannot be limited.
      </p>

      <LegalHeading>Ending things</LegalHeading>
      <p>
        You can stop using Swish Quest at any time and ask us to delete your account. We may change these terms; the date
        above shows the latest version, and continuing to use the site after a change means you accept it.
      </p>
    </LegalPage>
  );
}
