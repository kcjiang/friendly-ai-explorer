import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    id:          string;
    role:        string;
    accessToken: string;
  }

  interface Session {
    accessToken: string;
    user: {
      id:     string;
      name:   string;
      email:  string;
      role:   string;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id:          string;
    role:        string;
    accessToken: string;
  }
}
