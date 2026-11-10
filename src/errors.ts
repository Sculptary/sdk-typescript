export class SculptaryError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) {
    super(message);
    this.name = "SculptaryError";
  }
}
