import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { ImageCropModal } from "./ImageCropModal";
import * as profileUpload from "@/lib/profileUpload";

jest.mock("react-image-crop", () => ({
  __esModule: true,
  default: ({
    children,
    onChange,
  }: {
    children: React.ReactNode;
    onChange: (pixelCrop: unknown, percentCrop: unknown) => void;
  }) => (
    <div data-testid="react-crop">
      {children}
      <button
        type="button"
        onClick={() =>
          onChange(
            { unit: "px", x: 10, y: 10, width: 80, height: 80 },
            { unit: "%", x: 10, y: 10, width: 80, height: 80 }
          )
        }
      >
        set-crop
      </button>
    </div>
  ),
  centerCrop: (c: unknown) => c,
  makeAspectCrop: (c: unknown) => c,
}));

jest.mock("@/lib/profileUpload", () => ({
  __esModule: true,
  ...jest.requireActual("@/lib/profileUpload"),
  cropImageToBlob: jest.fn().mockResolvedValue(new Blob(["x"], { type: "image/jpeg" })),
}));

const mockCrop = profileUpload.cropImageToBlob as jest.Mock;

function renderModal(overrides: Partial<Parameters<typeof ImageCropModal>[0]> = {}) {
  const onCancel = jest.fn();
  const onConfirm = jest.fn().mockResolvedValue(undefined);
  const props = {
    open: true,
    src: "data:image/jpeg;base64,abc",
    aspect: 1,
    title: "Crop profile picture",
    onCancel,
    onConfirm,
    ...overrides,
  };
  const { container } = render(<ImageCropModal {...props} />);
  return { onCancel, onConfirm, container };
}

describe("ImageCropModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the crop UI with the given title", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Crop profile picture")).toBeInTheDocument();
  });

  it("shows a live preview once a crop is selected", () => {
    renderModal();
    expect(screen.queryByRole("img", { name: "Crop preview" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("set-crop"));
    expect(screen.getByRole("img", { name: "Crop preview" })).toBeInTheDocument();
  });

  it("calls onCancel when cancelled", () => {
    const { onCancel } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel via the close button", () => {
    const { onCancel } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("confirms with the cropped blob", async () => {
    const { onConfirm } = renderModal({ aspect: 1 });

    fireEvent.click(screen.getByText("set-crop"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Crop & Upload/ })).toBeEnabled()
    );

    fireEvent.click(screen.getByRole("button", { name: /Crop & Upload/ }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(mockCrop).toHaveBeenCalledTimes(1);
  });

  it("shows uploading state and disables actions while uploading", () => {
    renderModal({ isUploading: true });
    expect(screen.getByText("Uploading…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Uploading/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close modal" })).toBeDisabled();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderModal();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
