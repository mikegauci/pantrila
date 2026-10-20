export function NutritionSource() {
  return (
    <>
      Nutrition calculated from ingredient weights using{' '}
      <a className="underline" href="https://fdc.nal.usda.gov/">USDA FoodData Central (SR Legacy 2018-04)</a>
      {' '}and, for supported additions,{' '}
      <a className="underline" href="https://ciqual.anses.fr/">Anses. 2025. Ciqual French food composition table</a>.
      {' '}Ciqual carbohydrate includes fibre; qualified fibre values use a disclosed upper bound.
      {' '}Values are estimates.{' '}
      <a className="underline" href="https://ciqual.anses.fr/cms/en/node/22">Ciqual reuse terms</a>.
    </>
  )
}
