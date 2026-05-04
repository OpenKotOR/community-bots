/** Twenty HF-generated square-pyramid holocron stills (diverse lore prompts); cycled in `HolocronSanctum`. */
const frameBase = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}holocron/frames/`

export const HOLOCRON_FRAME_SRCS: readonly string[] = Array.from(
  { length: 20 },
  (_, i) => `${frameBase}holo-${String(i).padStart(2, "0")}.png`,
)
