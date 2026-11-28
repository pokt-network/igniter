import { User } from "./db/schema";

declare global {
  interface Window {
    pocketNetwork: any;
  }
}

declare module "next-auth" {
  /**
   * Returned by `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
   */
  interface Session {
    user: User;
    isAppBootstrapped: boolean;
    /** Ms left until the absolute end (login + SESSION_MAX_AGE_SECONDS), by the server clock when read. */
    sessionRemainingMs?: number;
  }
}
