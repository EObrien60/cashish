import { randomUUID } from "crypto";

export function uid(): string {
  return randomUUID();
}
