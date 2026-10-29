import type { Metadata } from "next";
import { LEGAL } from "../../configurations/legal";
import { SITE_NAME } from "../../configurations/site";
import LegalPage, { LegalHeading, LegalList, LegalSummary, MailLink, OperatorBlock, LegalLink } from "../../components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `The rules for using ${LEGAL.service}: accounts, fair play, advertising, moderation, reporting content, and your rights.`,
  alternates: { canonical: "/terms" },
  // A child openGraph/twitter replaces the layout's wholesale (including the root share image), so the
  // shared fields are repeated.
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", url: "/terms", title: `Terms of Service | ${SITE_NAME}`, images: ["/opengraph-image"] },
  twitter: { card: "summary_large_image", title: `Terms of Service | ${SITE_NAME}`, images: ["/opengraph-image"] },
};

export default function TermsPage() {
  const law = LEGAL.country ? `the law of ${LEGAL.country}` : "the law of the country where the operator is established (see the contact details above)";
  return (
    <LegalPage title="Terms of Service" path="/terms">
      <LegalSummary>
        <strong>The short version.</strong> {LEGAL.service} is a free game. It may show ads to pay for running it, but you
        never have to click or watch one to play. Play fair, be kind, keep your name and photo appropriate, and
        don&apos;t cheat, attack the site or fake clicks on ads. If we have to act against your account we tell you why and
        you can ask us to look again. You can delete your account whenever you like. Our{" "}
        <LegalLink href="/privacy">Privacy Policy</LegalLink> explains what we do with your data, including for ads.
      </LegalSummary>

      <LegalHeading id="who">1. Who we are and what these terms are</LegalHeading>
      <p>
        These terms are an agreement between you and the operator of {LEGAL.service}, a free website of NBA trivia games
        with optional accounts, leaderboards, friends and online matches. It is run by one person, named below, who pays
        for the service and may earn money from advertising shown on it (see section 10).
      </p>
      <OperatorBlock />
      <p>
        By creating an account, or by using the site, you agree to these terms. When you create an account, by email or
        with Google, the sign-up screen says under its buttons that doing so means you agree to these terms and the
        Privacy Policy (we record which version, when, and how). If you do not agree, please do not use the service.
      </p>

      <LegalHeading id="eligibility">2. Who can use it</LegalHeading>
      <LegalList>
        <li>Anyone can play as a guest.</li>
        <li>You must be {LEGAL.minimumAge} or older to create an account.</li>
        <li>You may not use the service if the law of your country forbids it, if you are located in the Russian Federation, or in a country or region under comprehensive international sanctions, or if you are on a sanctions list.</li>
        <li>If you use the service for a company or other organisation, you confirm you can bind it to these terms.</li>
      </LegalList>

      <LegalHeading id="account">3. Your account</LegalHeading>
      <p>
        Give a real email address you control. Keep your password and sign-in secret and tell us at <MailLink /> if you think
        someone else has used your account. One person, one account. Your display name does not have to be unique, so your
        player ID is what identifies you. You can delete your account at any time from your profile.
      </p>

      <LegalHeading id="service">4. The service</LegalHeading>
      <p>
        {LEGAL.service} is provided free of charge and &ldquo;as is&rdquo;. To pay for running it, the site may show
        advertising. Ads can appear, change or stop at any time, and you never have to click, watch or buy anything to
        play. Questions, answers and statistics come from public sources and may contain mistakes. Games, points, ranks and
        features can change, pause or end, and the service can be unavailable from time to time. Points, ranks and
        leaderboard positions have no cash or other value and cannot be transferred. We will not charge you for the service
        without agreeing it with you first.
      </p>

      <LegalHeading id="rules">5. Play fair</LegalHeading>
      <LegalList>
        <li>Do not use a display name or photo that is hateful, sexual, violent, harassing, misleading, impersonates someone, or shows someone who has not agreed to it.</li>
        <li>Do not harass, threaten or abuse other players, in matches or elsewhere.</li>
        <li>Do not cheat: no bots, scripts or automation, no farming of points, no exploiting bugs, no sharing answers during a match. Report bugs to us instead.</li>
        <li>Do not click, view or reload ads artificially: no clicking ads to help us or to hurt us, no asking others to, no bots, scripts or tools that load or click ads, and no hiding or disguising ads. We may suspend an account that does this (section 7).</li>
        <li>Do not attack, overload, scrape or try to break into the service or other people&apos;s accounts.</li>
        <li>Do not use the service for anything unlawful.</li>
        <li>You may use an ad blocker; the games work the same with or without ads.</li>
      </LegalList>

      <LegalHeading id="content">6. What you add (name, photo)</LegalHeading>
      <p>
        You stay the owner of your display name and photo. You give us a worldwide, free, non-exclusive licence to store them
        and to show them to other players and on leaderboards for as long as your account exists, and only to run the service.
        You confirm that you have the right to use them and that they follow these terms. Your photo and name are visible to
        other players, so do not add anything you want to keep private. You can remove your photo at any time and delete your
        account to remove everything.
      </p>

      <LegalHeading id="moderation">7. Moderation, bans and appeals</LegalHeading>
      <LegalList>
        <li>
          <strong>How it works.</strong> Display names and photos are checked automatically. A clearly not-allowed name or
          photo is refused and counts as a strike; the third strike bans the account. We may also remove content, reset
          points, or suspend or ban an account that breaks section 5 or the law, including for cheating or abuse.
        </li>
        <li>
          <strong>You are told why.</strong> When we restrict or ban your account we tell you what we did, the reason, whether
          an automatic tool was involved, and how to challenge it.
        </li>
        <li>
          <strong>Appeals.</strong> Press Appeal on the ban screen, or write to <MailLink /> from the account&apos;s email (or quoting your player ID), and a person will
          look again, normally within 14 days, and tell you the outcome and reasons. A wrongly applied strike or ban is reversed.
        </li>
        <li>
          <strong>Your data rights are not affected</strong> by a ban: you can still ask us to export or delete your data (see
          the Privacy Policy).
        </li>
      </LegalList>

      <LegalHeading id="report">8. Reporting content and copyright</LegalHeading>
      <p>
        To report a player, a name or photo, or anything you think is illegal, email <MailLink /> with the player ID, what
        you saw and why it is a problem, and your own name and email so we can answer. We acknowledge reports promptly, look
        at them with care, remove what is unlawful or breaks these terms, and tell you what we decided. Anyone whose content
        is removed gets the explanation in section 7.
      </p>
      <p>
        If you believe something on the service infringes your copyright or trademark, email us the work concerned, where it
        appears, your contact details, a statement that you are the owner or authorised to act, and that the information is
        accurate. We will act on valid notices, and we end the accounts of people who repeatedly infringe. Anyone whose
        content was removed can send us a counter-notice.
      </p>

      <LegalHeading id="ip">9. Intellectual property and the NBA</LegalHeading>
      <p>
        The site, its design, text and code belong to the operator or its licensors. {LEGAL.service} is an independent
        website made by a basketball fan and run by the operator named in section 1; it may carry advertising to pay for
        itself. It is <strong>not affiliated with, endorsed by or sponsored by the NBA, any NBA team, the players&apos;
        association, or any player</strong>, and an ad shown next to a question does not mean that any of them, or we,
        endorse the advertiser. NBA, team and player names and images are the property of their owners and appear here as
        part of the trivia games (for example team names and colours, and player photos in questions). If you own rights in
        anything shown and want it changed or removed, email us and we will deal with it quickly.
      </p>

      <LegalHeading id="thirdparty">10. Other people&apos;s services and advertising</LegalHeading>
      <p>
        Signing in with Google is governed by Google&apos;s own terms and privacy policy. Player photos are loaded from Wikimedia
        Commons (see the photo credits page); see the{" "}
        <LegalLink href="/privacy#shared">Privacy Policy, section 5</LegalLink>. We are not responsible for services we do
        not run.
      </p>
      <p id="ads">
        <strong>Ads.</strong> When the site shows ads, they are supplied by Google (Google AdSense) and the advertisers and ad
        partners Google works with, and they are marked as ads. We choose where ads can appear and can block some kinds of
        ads, but we do not pick each ad, and the advertiser is responsible for what its ad says. An ad that links somewhere
        takes you to the advertiser&apos;s site, which has its own terms and privacy policy; anything you buy or sign up for
        there is between you and the advertiser. Advertisers never get your account details, such as your email, display
        name, player ID or scores. The ads are non-personalised (not based on your browsing) for every visitor. How ads
        use cookies and your device&apos;s data, and the choices you have, are explained in the{" "}
        <LegalLink href="/privacy#storage">Privacy Policy, section 11</LegalLink>. If you see an ad that is offensive,
        misleading or illegal, tell us at <MailLink /> with the page and a screenshot if you can, and we will ask for it to
        be blocked.
      </p>

      <LegalHeading id="ending">11. Ending your use</LegalHeading>
      <p>
        You can stop at any time and delete your account from your profile. We may suspend or end your access if you break
        these terms (see section 7), if the law requires it, or if we close the service. If we close the service we will give
        reasonable notice. Sections that by their nature should survive (for example 9, 12 and 13) do.
      </p>

      <LegalHeading id="changes">12. Changes to these terms</LegalHeading>
      <p>
        We may update these terms, for example when we add a feature, start or stop showing ads, or the law changes. We will
        update the date and describe what changed, and for a significant change we will say so on the site&apos;s home page
        for at least 14 days before it applies. If you do not accept a change you can delete your account, at no cost,
        before it applies or within 30 days after; using the service after the date means you accept it. Earlier versions
        are available on request.
      </p>
      <p>
        This version was published on {LEGAL.updated}. Accounts created from that date accept it when they sign up. For
        accounts created before, it applies from {LEGAL.changeNotice.effective}; until then the previous version applies
        to them.
      </p>

      <LegalHeading id="liability">13. Our responsibility</LegalHeading>
      <p>
        We take care running the service, but it is free and provided as is. As far as the law allows, we are not liable for
        indirect or consequential loss, lost data or lost points, or for problems caused by things outside our control,
        including the content of ads and the products, offers and websites of advertisers, which we do not check one by one.
        We do not exclude or limit liability for death or personal injury caused by negligence, for fraud, for intentional or
        grossly negligent harm, or for anything the law does not allow us to limit, and nothing in these terms removes
        consumer rights you have under the law of the country where you live.
      </p>

      <LegalHeading id="law">14. Law and disputes</LegalHeading>
      <p>
        These terms are governed by {law}, without taking away the mandatory consumer-protection rules of the country where you
        live. If something goes wrong, please write to <MailLink /> first; most things can be sorted out that way. If you are a
        consumer you may bring a claim in the courts of your own country, and nothing here stops you using any complaint or
        dispute-resolution route the law gives you. We do not use arbitration clauses or class-action waivers against
        consumers.
      </p>

      <LegalHeading id="misc">15. The small print</LegalHeading>
      <p>
        If part of these terms is found unenforceable, the rest stays in force. These terms and the Privacy Policy are the
        whole agreement between us about the service. If we translate them, the English version applies where the two differ,
        except where the law of your country says otherwise. We may transfer our rights and obligations to a successor that
        takes over the service and tells you; you may not transfer yours.
      </p>

      <LegalHeading id="contact">16. Contact</LegalHeading>
      <p>
        Questions, appeals, reports (including about ads), privacy requests and legal notices, from players and from public
        authorities: <MailLink />. A person reads it, and we answer in English or Romanian.
      </p>
    </LegalPage>
  );
}
