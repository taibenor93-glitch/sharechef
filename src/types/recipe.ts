export type Recipe = {
  id: string
  user_id: string
  title: string
  description: string | null
  ingredients: string[]
  steps: string[]
  cook_time_minutes: number | null
  servings: number | null
  tags: string[] | null
  created_at: string
}
