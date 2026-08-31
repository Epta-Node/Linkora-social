import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { LeftSidebar } from "../LeftSidebar";
import { RightSidebar } from "../RightSidebar";

describe("LeftSidebar", () => {
  it("renders logo and all 7 navigation items", () => {
    render(<LeftSidebar />);
    expect(screen.getByText("Linkora")).toBeInTheDocument();
    expect(screen.getByText("Ohcine")).toBeInTheDocument();
    expect(screen.getByText("Fumcine")).toBeInTheDocument();
    expect(screen.getByText("O6LAMB")).toBeInTheDocument();
    expect(screen.getByText("USAS3BB")).toBeInTheDocument();
    expect(screen.getByText("VBALSBB")).toBeInTheDocument();
    expect(screen.getByText("VewITB")).toBeInTheDocument();
    expect(screen.getByText("Doots")).toBeInTheDocument();
    expect(screen.getByText("My Soore")).toBeInTheDocument();
  });

  it("toggles collapse mode when collapse button is clicked", () => {
    render(<LeftSidebar />);
    const collapseButton = screen.getByRole("button", { name: /collapse sidebar/i });
    fireEvent.click(collapseButton);

    expect(screen.queryByText("Ohcine")).not.toBeInTheDocument();
  });
});

describe("RightSidebar", () => {
  it("renders search input, user profile, trending topics, and suggested connections", () => {
    render(<RightSidebar />);
    expect(screen.getByPlaceholderText("Search Linkora...")).toBeInTheDocument();
    expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
    expect(screen.getByText("@7CAI.326")).toBeInTheDocument();
    expect(screen.getByText("Trending Topic")).toBeInTheDocument();
    expect(screen.getByText("Sorgecte Connocticins")).toBeInTheDocument();
  });
});
