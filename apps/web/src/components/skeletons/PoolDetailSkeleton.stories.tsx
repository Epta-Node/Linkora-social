import type { Meta, StoryObj } from "@storybook/react";
import { PoolDetailSkeleton } from "./PoolDetailSkeleton";

const meta = {
  title: "Skeletons/PoolDetailSkeleton",
  component: PoolDetailSkeleton,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Loading state for /pools/[id]: balance, threshold, admin list and deposit/withdraw tabs shimmer as independent blocks inside the real page layout.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ background: "var(--color-surface-1)", minHeight: "100vh" }}>
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof PoolDetailSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
