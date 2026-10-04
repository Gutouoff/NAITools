import templates from "./langbai-reverse-defaults.json" with { type: "json" };

/** Return fresh original packaged templates, never saved user overrides. */
export function getBuiltInReverseTemplates() {
  return { ...templates };
}
