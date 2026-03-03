import { join } from "path";

export const MAX_RETRIES = 3;
export const STATE_FILE = join(process.cwd(), ".agents", "hal", "state.json");
export const DEFINITION_DRAFT_FILE = join(process.cwd(), ".agents", "hal", "definition.md");
