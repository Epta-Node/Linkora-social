"use client";

import { useParams } from "next/navigation";
import { FollowList } from "@/components/FollowList";

export default function FollowingPage() {
  const params = useParams();
  const address = (params?.address as string) || "";

  return <FollowList address={address} type="following" />;
}
