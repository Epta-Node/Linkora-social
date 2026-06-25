import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { NotificationsSection } from "./NotificationsSection";

describe("NotificationsSection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should have no accessibility violations", async () => {
    const { container } = render(<NotificationsSection />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should display notification settings", () => {
    render(<NotificationsSection />);

    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("Browser Push Notifications")).toBeInTheDocument();
    expect(screen.getByText("New Followers")).toBeInTheDocument();
    expect(screen.getByText("New Likes")).toBeInTheDocument();
    expect(screen.getByText("New Comments")).toBeInTheDocument();
    expect(screen.getByText("Direct Messages")).toBeInTheDocument();
    expect(screen.getByText("Pool Activity")).toBeInTheDocument();
    expect(screen.getByText("Governance Updates")).toBeInTheDocument();
  });

  it("should toggle notification settings", () => {
    render(<NotificationsSection />);

    const newFollowersToggle = screen.getByLabelText("Toggle New Followers");

    // Initially enabled
    expect(newFollowersToggle).toHaveAttribute("aria-checked", "true");

    // Toggle off
    fireEvent.click(newFollowersToggle);
    expect(newFollowersToggle).toHaveAttribute("aria-checked", "false");

    // Toggle back on
    fireEvent.click(newFollowersToggle);
    expect(newFollowersToggle).toHaveAttribute("aria-checked", "true");
  });

  it("should persist settings to localStorage", () => {
    render(<NotificationsSection />);

    const newLikesToggle = screen.getByLabelText("Toggle New Likes");
    fireEvent.click(newLikesToggle);

    const savedSettings = localStorage.getItem("notification_settings");
    expect(savedSettings).toBeTruthy();

    const parsed = JSON.parse(savedSettings!);
    expect(parsed.newLikes).toBe(false);
  });

  it("should have proper ARIA attributes on toggle switches", () => {
    render(<NotificationsSection />);

    const toggles = screen.getAllByRole("switch");
    toggles.forEach((toggle) => {
      expect(toggle).toHaveAttribute("aria-checked");
    });
  });

  it("should request notification permission when enabling push", async () => {
    const mockRequestPermission = jest.fn().mockResolvedValue("granted");
    window.Notification.requestPermission = mockRequestPermission;

    render(<NotificationsSection />);

    const pushToggle = screen.getByRole("switch", { checked: false });
    fireEvent.click(pushToggle);

    expect(mockRequestPermission).toHaveBeenCalled();
  });
});
