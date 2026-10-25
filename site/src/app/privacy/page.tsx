import type { Metadata } from "next"

import { LegalPage } from "@/components/legal"
import { APP_URL, CONTACT_EMAIL } from "@/lib"

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Pantrila stores about you, who processes it and how to have it deleted.",
}

export default function Privacy() {
  const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
  return (
    <LegalPage title="Privacy" updated="25 October 2026">
      <p>
        Pantrila is an AI cooking and meal-planning assistant at <a href={APP_URL}>app.pantrila.com</a>. Pantrila
        decides how your data is used (it is the “data controller”). Questions or requests: {mail}.
      </p>
      <p>
        In short: Pantrila keeps what you tell it so it can plan your meals, sends what you type to an AI model to
        answer you, shows no ads, uses no tracking cookies and sells nothing.
      </p>

      <h2>What Pantrila stores</h2>
      <ul>
        <li>
          <strong>Your account.</strong> If you continue with Google: your email address, name and profile picture from
          Google. If you sign in with an email link: your email address. As a guest: an anonymous account id only.
        </li>
        <li>
          <strong>Your food profile.</strong> Diet, allergies, foods you avoid, nutrition targets and the number of
          people you cook for. Allergies and diets can reveal health or religious information; they are used only to
          choose and check your recipes.
        </li>
        <li>
          <strong>What you add.</strong> Your pantry, meal plans, assistant chats (the latest 100), your cookbook
          recipes and their photos, your profile picture, and the meals you mark as cooked (the latest 500).
        </li>
        <li>
          <strong>Usage counts.</strong> When you use an AI feature, its kind, time and cost, to enforce the
          allowances of your plan.
        </li>
        <li>
          <strong>Your plan.</strong> Whether you have Pantrila Pro, through which store, which subscription, whether it
          is a free trial and when it renews or ends. Pantrila never sees your card or payment details.
        </li>
      </ul>
      <p>
        Pantrila does not keep the photos, pages, posts or videos you import. While an import runs, what you sent
        (the link, text or photos) is held in Pantrila&rsquo;s database so the import can finish even if the server
        restarts; photos are deleted as soon as the import ends, and the rest within an hour. Recipe photos and profile pictures are stored at web addresses that are public but hard to
        guess.
      </p>

      <h2>Why</h2>
      <p>
        To provide the service you asked for: finding and checking recipes, planning meals, keeping your cookbook and
        pantry, and answering your questions (this is the legal basis of “performing a contract”). Your allergies and
        diet are used because you entered them so Pantrila can respect them. Usage counts and short-lived traces keep
        the service working and affordable (“legitimate interest”).
      </p>

      <h2>Who processes it</h2>
      <ul>
        <li>
          <strong>Supabase</strong> stores your account and data, in the EU (Stockholm).
        </li>
        <li>
          <strong>Render</strong> runs Pantrila’s server, in the EU (Frankfurt).
        </li>
        <li>
          <strong>Vercel</strong> serves the website and app pages.
        </li>
        <li>
          <strong>OpenAI</strong> receives what the AI features need to answer you: your messages, profile and pantry,
          recipe text, and anything you import. Requests are sent with storage turned off, and OpenAI’s API terms say
          this data is not used to train its models.
        </li>
        <li>
          <strong>LangSmith</strong> (LangChain, EU region) keeps traces of meal plans and chats for a limited time so
          problems and quality can be checked.
        </li>
        <li>
          <strong>Apify</strong> fetches a public social media post when you ask Pantrila to import it. It receives the
          post link only.
        </li>
        <li>
          <strong>Apple and Google</strong> sell Pantrila Pro in their app stores and handle payment, renewals,
          cancellations and refunds under their own privacy terms.
        </li>
        <li>
          <strong>RevenueCat</strong> keeps track of Pantrila Pro subscriptions bought in the apps: your account id, the
          store, the subscription and its purchase, renewal and end dates, never your name, email or payment details.
          It tells Pantrila when your subscription changes. Your RevenueCat record is deleted with your account.
        </li>
        <li>
          <strong>Google</strong> signs you in if you choose Google.
        </li>
        <li>
          <strong>Resend</strong> delivers sign-in emails if you choose email sign-in.
        </li>
        <li>
          <strong>Sentry</strong> receives error reports, in the EU (Frankfurt): what went wrong, the page, your
          browser and your account id, but not your recipes, messages or email. Feedback you send from the app goes
          there too, with the email you add for a reply.
        </li>
        <li>
          <strong>PostHog</strong> counts how people use Pantrila, in the EU (Frankfurt), so we can see where it
          helps and where people get stuck: the day you first used it and the days you came back, and when you
          import a recipe, make a plan or open cooking mode, and when a Pantrila Pro trial or subscription starts,
          renews, is cancelled or ends. It gets your account id and whether you are a guest,
          never your email, IP address, location, recipes or messages. Pantrila sends this from its server; nothing
          is stored in your browser for it.
        </li>
        <li>
          <strong>PostHog</strong> also keeps recordings of your visits, unless you turn off &ldquo;Record my
          visits&rdquo; in Profile. A recording shows your taps, scrolling and the screens you see, including your
          diet and allergy settings and the recipes and chats on screen; anything you type is hidden. Recordings are
          linked to your account id, kept for 30 days, and deleted with your account.
        </li>
      </ul>
      <p>
        Some of these companies are based in the United States, so your data may be processed there under their
        standard data protection terms.
      </p>

      <h2>In your browser</h2>
      <p>
        Pantrila keeps your sign-in session and a few preferences (such as °C or °F, whether you finished the tour,
        and whether you turned recordings off) in your browser’s local storage. While recordings are on, PostHog
        also keeps an id for them there; turning them off stops the recording and resets that id. There are no advertising cookies
        and no analytics cookies. As a guest, clearing
        your browser data signs you out for good; add Google from your profile to keep your data.
      </p>

      <h2>How long</h2>
      <p>
        Your data stays until you delete it. You can delete recipes, chats, pantry items and photos yourself in the
        app at any time, or your whole account from Profile, Delete account: that removes everything Pantrila holds
        about you, including your sign-in, straight away. It does not cancel a Pantrila Pro subscription: cancel that
        in your phone&rsquo;s settings (App Store or Google Play) first.
      </p>

      <h2>Your rights</h2>
      <p>
        You can delete your account yourself in the app (Profile, Delete account). You can also ask for a copy of
        your data, to correct it, to delete it, or to object to how it is used. Write to {mail} from the email linked to your account and you will get an answer within a month.
        A guest account has no email, so add Google from your profile first. You can also complain to your data
        protection authority.
      </p>

      <h2>Children</h2>
      <p>Pantrila is not meant for children under 16.</p>

      <h2>Changes</h2>
      <p>If this policy changes in a way that matters, the date above changes and the app will say so.</p>
    </LegalPage>
  )
}
