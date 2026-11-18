import type { ResultsMessages } from "./en";

/** Messages for calculated results saved with the project (ta). */
export const resultsTa = {
  "results.saved": "திட்டத்துடன் சேமிக்கப்பட்டது.",
  "results.savedAt": "திட்டத்துடன் சேமிக்கப்பட்டது, {when} அன்று கணக்கிடப்பட்டது.",
  "results.stale": "காலாவதியானது: கணக்கிட்ட பிறகு இது சார்ந்துள்ள ஒன்று மாறியுள்ளது.",
  "results.staleAt": "காலாவதியானது: {when} அன்று கணக்கிட்ட பிறகு இது சார்ந்துள்ள ஒன்று மாறியுள்ளது.",
  "results.recalculate": "மீண்டும் கணக்கிடு",
  "results.recalculating": "மீண்டும் கணக்கிடுகிறது…",
  "results.saveFailed": "திட்டத்துடன் சேமிக்க முடியவில்லை: {error}",
} satisfies ResultsMessages;
