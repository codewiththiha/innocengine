export class OpeningSessionTracker {
  private activeOpeningId: string | null = null;
  private line: string[] = [];
  private nextPly = 0;

  public startOpening(openingId: string, line: string[]) {
    this.activeOpeningId = openingId;
    this.line = line;
    this.nextPly = 0;
  }

  public registerMove(san: string): boolean {
    if (!this.activeOpeningId) return false;
    const expected = this.line[this.nextPly];
    if (!expected) {
      this.activeOpeningId = null;
      return false;
    }
    if (san === expected) {
      this.nextPly += 1;
      return true;
    }
    this.activeOpeningId = null;
    return false;
  }

  public getActiveOpeningId(): string | null {
    return this.activeOpeningId;
  }

  public isActive(): boolean {
    return this.activeOpeningId !== null;
  }

  public reset() {
    this.activeOpeningId = null;
    this.line = [];
    this.nextPly = 0;
  }
}

export const globalOpeningSession = new OpeningSessionTracker();
