import { auth } from "@/../auth";

export const dynamic = "force-dynamic";

// Stream with the session's bearer token; never buffer firmware in browser JS.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.accessToken) return new Response(null, { status: 401 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 400 });
  const headers = new Headers({
    Authorization: `Bearer ${session.accessToken}`,
  });
  for (const name of ["range", "if-range"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await fetch(
    `${process.env.BACKEND_URL ?? "http://localhost:8000"}/api/v1/files/${id}/${new URL(request.url).searchParams.get("thumbnail") === "1" ? "thumbnail" : "download"}`,
    {
      headers,
      method: request.method,
      cache: "no-store",
      signal: request.signal,
    },
  );
  const outgoing = new Headers();
  for (const name of [
    "content-type",
    "content-length",
    "content-disposition",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
    "cache-control",
    "x-content-type-options",
  ]) {
    const value = response.headers.get(name);
    if (value) outgoing.set(name, value);
  }
  if (
    response.ok &&
    new URL(request.url).searchParams.get("preview") === "1" &&
    /^(application\/pdf|image\/(png|jpeg|gif|webp)|video\/(mp4|webm|ogg))(;|$)/.test(
      response.headers.get("content-type") ?? "",
    )
  ) {
    outgoing.set("content-disposition", "inline");
  }
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    headers: outgoing,
  });
}
export const HEAD = GET;
