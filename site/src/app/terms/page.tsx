import Link from "next/link"
import type { Metadata } from "next"

import { LegalPage } from "@/components/legal"
import { CONTACT_EMAIL } from "@/lib"

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for using Pantrila.",
}

export default function Terms() {
  return (
    <LegalPage title="Terms" updated="25 October 2026">
      <p>
        These terms cover your use of Pantrila: the website at pantrila.com, the app at app.pantrila.com and the
        Pantrila apps for iPhone and Android. By using Pantrila you agree to them. When you get the apps from the App
        Store or Google Play, that store&rsquo;s own terms also apply to the download and to purchases; Apple and
        Google are not responsible for Pantrila or its support.
      </p>

      <h2>What Pantrila is</h2>
      <p>
        Pantrila is a cooking and meal-planning assistant that uses AI. It is free to use, with optional paid Pantrila
        Pro for larger allowances. Features, allowances and the service itself may change or stop. It is offered as it is, without promises that it will always be available or free of
        mistakes.
      </p>

      <h2>Food, allergies and health</h2>
      <ul>
        <li>
          Pantrila is <strong>not medical or dietary advice</strong>. Talk to a doctor or dietitian about medical
          diets, pregnancy, eating disorders or serious health conditions.
        </li>
        <li>
          Pantrila checks recipes against the allergies and diets you enter, but ingredients, products and recipes vary.{" "}
          <strong>If an allergy is serious, check every ingredient and product label yourself.</strong>
        </li>
        <li>
          Nutrition values are estimates from public food data and ingredient weights. AI answers and imported recipes
          can be wrong; use your own judgement when cooking, especially with food safety and temperatures.
          Voice commands and timers help but can mishear or be silenced by your phone&rsquo;s settings; keep an eye
          on what is cooking.
        </li>
      </ul>

      <h2>Pantrila Free and Pantrila Pro</h2>
      <ul>
        <li>
          Pantrila Free has limited AI allowances (for example one meal plan a week and five recipe imports a month).
          Browsing, search, cooking mode, your pantry, grocery list and cookbook are free and unlimited.
        </li>
        <li>
          <strong>Pantrila Pro</strong> costs €4.99 a month or €29.99 a year (prices in other currencies are set by the
          store). It gives larger daily allowances for fair personal use and AI recipe photos. It is sold in the
          Pantrila iPhone and Android apps through the App Store or Google Play, and works on the web with the same
          account.
        </li>
        <li>
          <strong>Free trial.</strong> New subscribers get 7 days free. Unless you cancel at least 24 hours before the
          trial ends, it becomes a paid subscription and the store charges you.
        </li>
        <li>
          <strong>Renewal.</strong> Pro renews automatically each month or year at the then-current price until you
          cancel. Cancel any time in your phone&rsquo;s settings (App Store or Google Play subscriptions); Pro stays
          on until the end of the period you paid for. Deleting your Pantrila account does not cancel it.
        </li>
        <li>
          <strong>Payments and refunds</strong> are handled by Apple or Google under their terms; ask them for a
          refund. Your rights as a consumer under the law are not affected.
        </li>
      </ul>

      <h2>Your account and content</h2>
      <ul>
        <li>
          You keep the rights to what you add. You let Pantrila store and process it only to run the service for you,
          as the <Link href="/privacy">privacy policy</Link> describes.
        </li>
        <li>
          Import recipes for your own cooking. Respect creators: Pantrila credits the source, and you should not
          republish recipes you do not have the right to share.
        </li>
        <li>
          Guest accounts live in your browser or on your phone. If you clear the browser, delete the app or sign out
          before adding Google (or Apple, in the iPhone app), the account cannot be recovered.
        </li>
      </ul>

      <h2>Fair use</h2>
      <p>
        Do not misuse Pantrila: no attempts to break or overload it, get around allowances, use it to collect
        other people’s data, or use it for anything unlawful. Accounts that do may be limited or removed.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, Pantrila is not liable for indirect losses, or for harm from
        relying on a recipe, plan or answer without checking it. Nothing here limits rights you have by law as a
        consumer.
      </p>

      <h2>Changes and contact</h2>
      <p>
        These terms may be updated; the date above shows when. Questions:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  )
}
