/** Links that open the app from outside. iOS's share extension opens `pantrila://dataUrl=…`, which
 * is no screen: it goes to the new-recipe screen, where `ShareHandler` hands it the share (signed
 * out, the welcome screen shows first). app.pantrila.com links keep their path: recipe pages and
 * the plan are at the same paths as on the web. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return path.includes("dataUrl=") ? "/recipes/mine/new" : path
}
