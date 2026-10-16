// Public configuration. The publishable key is meant to be public: every table is protected by
// Row Level Security in Supabase, which is where the access rules live. Never put any other key here.
export const SUPABASE_URL = "https://lonzcppgdbsatwjgwozb.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_qZfy-JlKpZGn6cW5wAHldg_HI6cAyHh";

// Length of the sign-in code Supabase emails. Must match Authentication > Providers > Email >
// "Email OTP Length" in the Supabase dashboard (this project uses 8).
export const EMAIL_OTP_LENGTH = 8;
