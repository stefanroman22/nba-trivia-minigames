import type { Metadata } from "next";
import LegalPage, { LegalHeading, LegalList, MailLink } from "../../components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Swish Quest collects, why, who handles it, and how to have it deleted.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="7 October 2026">
      <p>
        Swish Quest (previously HOOPS24) is a free NBA trivia site. This page explains what we collect when you play, why,
        and what you can do about it. You can reach us at <MailLink />.
      </p>

      <LegalHeading>What we collect</LegalHeading>
      <LegalList>
        <li><strong>Playing as a guest</strong> collects nothing about you. Your browser may keep game preferences locally.</li>
        <li>
          <strong>An account</strong> holds your email address, the display name you choose, a short public player ID, your
          points, rank and game history, the friends and friend requests you make, and a profile photo if you upload one.
          Your email is never shown to other players. Your display name, player ID, rank, points and photo are visible to
          other players, for example on leaderboards and in online matches.
        </li>
        <li>
          <strong>Signing in with Google</strong> gives us your Google account&apos;s email address and a stable account
          identifier. We do not receive your Google password and we do not read anything else from your Google account.
        </li>
        <li>
          <strong>Passwords</strong> for email sign-ups are stored only as a salted hash. Accounts created with Google have
          no password here.
        </li>
        <li><strong>Feedback</strong> you send through the site is stored with your account if you are signed in.</li>
        <li>
          <strong>Moderation records.</strong> Display names and photos are checked automatically. When one is rejected we
          keep a record of the event, including a one-way hash of your network address (not the address itself), so repeated
          abuse can be handled.
        </li>
        <li>
          <strong>Sign-in tokens</strong> are kept in your browser&apos;s local storage so you stay signed in. We do not use
          advertising cookies or third-party analytics.
        </li>
      </LegalList>

      <LegalHeading>Why we use it</LegalHeading>
      <p>
        To run your account, keep scores and leaderboards, match you with other players, apply the rules of the site, and
        keep it secure. We do not sell your data and we do not use it for advertising.
      </p>

      <LegalHeading>Who handles it</LegalHeading>
      <p>
        The site and its servers run on Vercel. The account database runs on Supabase. Online matches run on a separate game
        server that receives your display name, player ID, rank and points while you play. Google handles the sign-in screen
        when you choose Google. These providers process data on our behalf; we share nothing else with anyone unless the law
        requires it.
      </p>

      <LegalHeading>How long we keep it</LegalHeading>
      <p>
        Account data is kept while your account exists. Moderation records are kept as long as they are needed to enforce
        the rules. Sign-in sessions end automatically after 90 days.
      </p>

      <LegalHeading>Your choices</LegalHeading>
      <p>
        You can change your display name and photo in your profile at any time. To see, correct or delete your data, or to
        delete your account, email us and we will do it. If you are in the EU or UK you also have the rights of access,
        correction, deletion, restriction and portability under data protection law, and you can complain to your local
        data protection authority.
      </p>

      <LegalHeading>Children</LegalHeading>
      <p>
        Swish Quest is not meant for children under 13, and we do not knowingly collect their data. If you believe a child
        has made an account, email us and we will remove it.
      </p>

      <LegalHeading>Changes</LegalHeading>
      <p>We will update this page, and its date, when anything material changes.</p>
    </LegalPage>
  );
}
