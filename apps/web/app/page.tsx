import { redirect } from "next/navigation";

export default function Home() {
  // Middleware routes authed users to /dashboard and others to /login,
  // but redirect here too as a safety net for direct hits.
  redirect("/dashboard");
}
