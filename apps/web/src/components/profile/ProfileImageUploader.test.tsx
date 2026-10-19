import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { ProfileImageUploader } from "./ProfileImageUploader";
import * as profileUpload from "@/lib/profileUpload";

jest.mock("@/lib/profileUpload", () => ({
  __esModule: true,
  ...jest.requireActual("@/lib/profileUpload"),
  fetchProfileImageUrl: jest.fn().mockResolvedValue(null),
  uploadWithProgress: jest.fn(),
  compressCroppedBlob: jest.fn().mockImplementation(async (b: Blob) => b),
}));

jest.mock("./ImageCropModal", () => ({
  ImageCropModal: ({
    open,
    onConfirm,
    onCancel,
    isUploading,
  }: {
    open: boolean;
    onConfirm: (blob: Blob) => void;
    onCancel: () => void;
    isUploading?: boolean;
  }) =>
    open ? (
      <div>
        <p>Mock Crop Modal {isUploading ? "uploading" : "ready"}</p>
        <button onClick={() => onConfirm(new Blob(["x"], { type: "image/jpeg" }))}>
          mock-confirm
        </button>
        <button onClick={onCancel}>mock-cancel</button>
      </div>
    ) : null,
}));

const mockFetch = profileUpload.fetchProfileImageUrl as jest.Mock;
const mockUpload = profileUpload.uploadWithProgress as jest.Mock;

function makeFile(name = "photo.jpg", type = "image/jpeg", bytes = 1024): File {
  const arr = new Uint8Array(bytes);
  return new File([arr], name, { type });
}

function makeOversizedFile(): File {
  const arr = new Uint8Array(6 * 1024 * 1024);
  return new File([arr], "huge.jpg", { type: "image/jpeg" });
}

function getDropZone(label: RegExp) {
  return screen.getByRole("button", { name: label });
}

describe("ProfileImageUploader", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue(null);
  });

  it("renders an accessible drop zone", async () => {
    const { container } = render(<ProfileImageUploader address="GTEST" kind="avatar" />);

    const zone = getDropZone(/drag and drop an image/i);
    expect(zone).toHaveAttribute("tabindex", "0");
    expect(zone).toHaveAttribute("aria-label", expect.stringContaining("Profile picture"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith("GTEST", "avatar"));
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("opens the crop modal when a valid file is dropped", async () => {
    render(<ProfileImageUploader address="GTEST" kind="avatar" />);
    const zone = getDropZone(/drag and drop an image/i);
    const file = makeFile();

    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/Mock Crop Modal/)).toBeInTheDocument();
    });
  });

  it("rejects unsupported file types with a clear error", async () => {
    render(<ProfileImageUploader address="GTEST" kind="avatar" />);
    const zone = getDropZone(/drag and drop an image/i);

    fireEvent.drop(zone, { dataTransfer: { files: [makeFile("doc.pdf", "application/pdf")] } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Unsupported file type/);
    });
    expect(screen.queryByText(/Mock Crop Modal/)).not.toBeInTheDocument();
  });

  it("rejects files over 5MB with a clear error", async () => {
    render(<ProfileImageUploader address="GTEST" kind="avatar" />);
    const zone = getDropZone(/drag and drop an image/i);

    fireEvent.drop(zone, { dataTransfer: { files: [makeOversizedFile()] } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/File size exceeds/);
    });
  });

  it("uploads the cropped file with progress and updates the preview", async () => {
    mockUpload.mockImplementation(
      (_file: File, _kind: string, _addr: string, onProgress: (p: number) => void) => {
        onProgress(50);
        return Promise.resolve("data:image/jpeg;base64,abc");
      }
    );

    render(<ProfileImageUploader address="GTEST" kind="avatar" />);
    const zone = getDropZone(/drag and drop an image/i);

    fireEvent.drop(zone, { dataTransfer: { files: [makeFile()] } });
    await waitFor(() => expect(screen.getByText(/Mock Crop Modal/)).toBeInTheDocument());

    fireEvent.click(screen.getByText("mock-confirm"));

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByRole("img", { name: /current profile avatar/i })).toHaveAttribute(
        "src",
        "data:image/jpeg;base64,abc"
      );
    });
    expect(screen.queryByText(/Mock Crop Modal/)).not.toBeInTheDocument();
  });

  it("cancels cropping without uploading", async () => {
    render(<ProfileImageUploader address="GTEST" kind="cover" />);
    const zone = getDropZone(/drag and drop an image/i);

    fireEvent.drop(zone, { dataTransfer: { files: [makeFile()] } });
    await waitFor(() => expect(screen.getByText(/Mock Crop Modal/)).toBeInTheDocument());

    fireEvent.click(screen.getByText("mock-cancel"));

    await waitFor(() => {
      expect(screen.queryByText(/Mock Crop Modal/)).not.toBeInTheDocument();
    });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("opens the file picker with the keyboard", () => {
    render(<ProfileImageUploader address="GTEST" kind="avatar" />);

    const zone = getDropZone(/drag and drop an image/i);
    const clickSpy = jest.spyOn(HTMLInputElement.prototype, "click");

    fireEvent.keyDown(zone, { key: "Enter" });

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("highlights the drop zone while dragging over", () => {
    render(<ProfileImageUploader address="GTEST" kind="avatar" />);
    const zone = getDropZone(/drag and drop an image/i);

    fireEvent.dragOver(zone, { dataTransfer: { dropEffect: "copy" } });
    expect(zone.className).toContain("border-violet-500");

    fireEvent.dragLeave(zone);
    expect(zone.className).not.toContain("border-violet-500");
  });

  it("hydrates the current image URL on mount", async () => {
    mockFetch.mockResolvedValue("data:image/jpeg;base64,existing");

    render(<ProfileImageUploader address="GTEST" kind="cover" />);

    await waitFor(() => {
      expect(screen.getByRole("img", { name: /current profile cover/i })).toHaveAttribute(
        "src",
        "data:image/jpeg;base64,existing"
      );
    });
  });
});
