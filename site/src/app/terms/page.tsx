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
    <LegalPage title="Terms" updated="22 October 2026">
      <p>
        These terms cover your use of Pantrila, the website at pantrila.com and the app at app.pantrila.com. By using
        Pantrila you agree to them.
      </p>

      <h2>What Pantrila is</h2>
      <p>
        Pantrila is a free cooking and meal-planning assistant that uses AI. Features, daily allowances and the service
        itself may change or stop. It is offered as it is, without promises that it will always be available or free of
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
          Guest accounts live in your browser. If you clear it before adding Google, the account cannot be recovered.
        </li>
      </ul>

      <h2>Fair use</h2>
      <p>
        Do not misuse Pantrila: no attempts to break or overload it, get around daily allowances, use it to collect
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
