// Mirrors the Pantrila API models in src/pantrila/api.py and schema.py.

export type Allergen =
  | "celery" | "gluten" | "crustaceans" | "eggs" | "fish" | "lupin" | "milk" | "molluscs"
  | "mustard" | "tree_nuts" | "peanuts" | "sesame" | "soy" | "sulphites"
export type DietTag =
  | "vegan" | "vegetarian" | "pescatarian" | "gluten_free" | "dairy_free" | "nut_free"
  | "low_carb" | "high_protein"
export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "dessert"
export type Unit = "g" | "kg" | "ml" | "l" | "tsp" | "tbsp" | "cup" | "piece" | "pinch"

export interface Nutrition {
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fibre_g: number
}

export interface RecipeCard {
  id: string
  title: string
  summary: string
  cuisine: string
  meal_types: MealType[]
  diet_tags: DietTag[]
  allergens: Allergen[]
  total_minutes: number
  servings: number
  nutrition: Nutrition
  ingredient_count: number
  pantry_foods: string[]
  problems: string[]
  photo_url: string | null
}

export interface Ingredient {
  name: string
  food: string
  quantity: number
  unit: Unit
  grams: number
  in_pantry: boolean
  grams_per_ml?: number | null
  grams_per_piece?: number | null
}

export interface RecipeDetail extends RecipeCard {
  ingredients: Ingredient[]
  steps: string[]
}

export interface SearchRules {
  exclude_allergens: Allergen[]
  require_diets: DietTag[]
  max_minutes: number | null
  meal_types: MealType[]
  cuisines: string[]
  exclude_foods: string[]
}

export interface RecipeList {
  query: string
  rules: SearchRules
  recipes: RecipeCard[]
}

export interface SwapView {
  food: string
  replacement: string
  safe: boolean
  problems: string[]
  added_allergens: Allergen[]
  lost_diets: DietTag[]
  kcal_change: number
  protein_change: number
  nutrition: Nutrition
}

export interface SwapList {
  recipe_id: string
  food: string
  swaps: SwapView[]
}

export interface NutritionTargets {
  kcal: number | null
  /** An energy range (either end may be open); when set it replaces `kcal`. */
  min_kcal?: number | null
  max_kcal?: number | null
  min_protein_g: number | null
  max_carbs_g: number | null
}

export interface Profile {
  allergies: Allergen[]
  diets: DietTag[]
  exclude_foods: string[]
  max_minutes: number | null
  days: number
  meals: MealType[]
  targets: NutritionTargets
  pantry: string[]
  cuisines: string[]
  notes: string
}

export interface Food {
  key: string
  name: string
  aisle: string
  /** From `/foods` only: what converts its amounts (null: it is weighed). */
  grams_per_ml?: number | null
  grams_per_piece?: number | null
}

export interface PantryItem extends Food {
  quantity: number | null
  unit: Unit | null
  grams: number | null
}

export interface Meta {
  allergens: Allergen[]
  diets: DietTag[]
  meal_types: MealType[]
  units: Unit[]
  cuisines: string[]
  /** Platforms whose post videos Pantrila can hear from the link; empty when off. */
  reel_platforms?: string[]
}

export interface Limits {
  plans_per_day: number
  plans_left: number
  chats_per_day: number
  chats_left: number
  imports_per_day: number
  imports_left: number
  photos_per_day: number
  photos_left: number
}

export interface Me {
  id: string
  email: string | null
  anonymous: boolean
  avatar_url: string | null
  limits: Limits
}

/** recipe: cook it; leftovers: eat more of an earlier day's meal; skipped and eating_out keep
 * the recipe that was planned there so it can be added back. */
export type SlotKind = "recipe" | "leftovers" | "skipped" | "eating_out"

export interface PlanMeal {
  meal_type: MealType
  portions: number
  /** Null only for a skipped or eating-out meal whose old recipe is gone. */
  recipe: RecipeCard | null
  kind: SlotKind
  /** Set when the recipe is the person's own (its id is mine-<cookbook_id>). */
  cookbook_id: number | null
  from_day: number | null
  from_meal: MealType | null
  out_kcal: number | null
}

export interface PlanDay {
  day: number
  meals: PlanMeal[]
  nutrition: Nutrition
}

export interface PlanProblem {
  day: number
  meal_type: MealType
  recipe_id: string
  message: string
}

export interface PlanReport {
  model: string
  warnings: string[]
  first_draft_problems: string[]
  repairs: number
  fallbacks: number
  pantry_use: number
  path: string[]
  llm_calls: number
  tool_calls: number
  input_tokens: number
  output_tokens: number
  cost_usd: number | null
  latency_ms: number
}

export interface Plan {
  id: number
  created_at: string
  days: PlanDay[]
  notes: string
  targets: NutritionTargets
  problems: PlanProblem[]
  report: PlanReport
}

export interface MealOption {
  recipe: RecipeCard
  portions: number
  day_nutrition: Nutrition
  kcal_change: number
  protein_change: number
}

export interface MealOptions {
  plan_id: number
  day: number
  meal_type: MealType
  current: PlanMeal
  options: MealOption[]
  total: number
  offset: number
}

export interface GroceryItem {
  food: string
  aisle: string
  need_g: number
  have_g: number
  buy_g: number
  amount: string
  recipes: string[]
}

export interface GroceryList {
  people: number
  items: GroceryItem[]
  covered: GroceryItem[]
  /** Estimated foods of the person's own recipes, which the list cannot weigh. */
  unlisted?: string[]
}

export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
  output: string
}

export interface ChatReply {
  profile_problems: string[]
  draft_problems: string[][]
  thread_id: number
  text: string
  cited: RecipeCard[]
  flagged: string[]
  tool_calls: ToolCall[]
  pantry_changed: boolean
  cost_usd: number | null
  latency_ms: number
  drafts: CookbookRecipeIn[]
}

export interface ChatMessage {
  role: "user" | "assistant"
  text: string
  reply?: ChatReply | null
}

export interface ChatThreadSummary {
  id: number
  title: string
  messages: number
  updated_at: string
}

export interface ChatThread {
  id: number
  title: string
  messages: ChatMessage[]
  updated_at: string
}


// --- Cookbook: the person's own recipes ---

export type DietClass = "plant" | "dairy" | "egg" | "honey" | "fish" | "shellfish" | "meat"
export type RecipeSource = "manual" | "photo" | "link" | "post" | "text" | "video"
export type SourcePlatform = "tiktok" | "instagram" | "facebook"

/** Model estimate for a food missing from the ingredient table, per 100 g. */
export interface FoodEstimate {
  description: string
  diet_class: DietClass
  allergens: Allergen[]
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fibre_g: number
  grams_per_ml: number | null
  grams_per_piece: number | null
}

export interface RecipeLine {
  name: string
  quantity: number
  unit: Unit
  food: string | null
  estimate: FoodEstimate | null
  amount_estimate?: string | null
  /** The source's group heading ("For the sauce"); lines of a group are consecutive. */
  section?: string
}

/** A heading in the method, from step `first_step` (1-based) to the next heading. */
export interface StepSection {
  title: string
  first_step: number
}

export interface CookbookRecipeIn {
  title: string
  summary: string
  cuisine: string
  meal_types: MealType[]
  total_minutes: number
  servings: number
  ingredients: RecipeLine[]
  steps: string[]
  step_sections?: StepSection[]
  /** The author's notes, one per line. */
  notes?: string
  source: RecipeSource
  source_url: string | null
  /** Credit for a recipe from a social post: source_url is the post. */
  source_platform: SourcePlatform | null
  source_author: string | null
  /** The recipe site the post's caption linked to, when the recipe came from there. */
  recipe_url: string | null
}

export interface LineView extends RecipeLine {
  grams: number
  /** The food's grams per ml and per piece, for showing the line in another unit. */
  grams_per_ml?: number | null
  grams_per_piece?: number | null
}

export interface CookbookCard {
  id: number
  title: string
  summary: string
  cuisine: string
  meal_types: MealType[]
  total_minutes: number
  servings: number
  source: RecipeSource
  source_url: string | null
  source_platform: SourcePlatform | null
  source_author: string | null
  recipe_url: string | null
  created_at: string
  updated_at: string
  ingredient_count: number
  nutrition: Nutrition | null
  allergens: Allergen[]
  diet_tags: DietTag[]
  estimated: boolean
  invalid: string[]
  pantry_foods: string[]
  problems: string[]
  photo_url: string | null
}

export interface CookbookDetail extends CookbookCard {
  ingredients: (LineView & { in_pantry: boolean })[]
  steps: string[]
  step_sections: StepSection[]
  recipe: CookbookRecipeIn
}

export interface CookbookPreview {
  ingredients: LineView[]
  nutrition: Nutrition
  allergens: Allergen[]
  diet_tags: DietTag[]
  estimated: boolean
  problems: string[]
}

export interface ImportView {
  draft: CookbookRecipeIn
  notes: string[]
  cost_usd: number | null
  /** The part of cost_usd spent transcribing a video's sound. */
  transcription_cost_usd?: number | null
  media_cost_usd?: number | null
  latency_ms: number
}

export interface EstimateView {
  estimates: { name: string; estimate: FoodEstimate | null }[]
  cost_usd: number | null
}

export interface CookRequest {
  recipe_id?: string
  cookbook_id?: number
  servings: number
  update_pantry: boolean
}

export interface PantryChange {
  food: string
  name: string
  used_g: number
  unit: Unit
  before: number
  after: number | null
}

export interface Cooked {
  id: number
  recipe_id: string | null
  cookbook_id: number | null
  title: string
  servings: number
  pantry_updated: boolean
  cooked_at: string
}

export interface CookResult {
  cooked: Cooked | null
  pantry: PantryChange[]
}
