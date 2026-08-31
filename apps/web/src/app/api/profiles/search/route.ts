import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

  const mockProfiles = [
    {
      address: "GALICE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      username: "alice",
      display_name: "Alice Wonder",
      followerCount: 12,
    },
    {
      address: "GALICEDEV234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      username: "alice_dev",
      display_name: "Alice Developer",
      followerCount: 5,
    },
    {
      address: "GSTELLARPROFILE1234567890",
      username: "stellar_alice",
      display_name: "Stellar Alice",
      followerCount: 12,
    },
  ];

  if (!q) {
    return NextResponse.json({ profiles: [] });
  }

  const profiles = mockProfiles.filter(
    (p) =>
      p.username.toLowerCase().includes(q.toLowerCase()) ||
      (p.display_name && p.display_name.toLowerCase().includes(q.toLowerCase()))
  );

  return NextResponse.json({ profiles: profiles.length > 0 ? profiles : mockProfiles });
}
