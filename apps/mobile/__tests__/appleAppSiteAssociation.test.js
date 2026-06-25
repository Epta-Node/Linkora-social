const fs = require("fs");
const path = require("path");

function stripBlockComment(content) {
  return content.replace(/\/\*[\s\S]*?\*\//, "");
}

describe("apple-app-site-association", () => {
  it("has a valid appID and supported path patterns", () => {
    const aasaPath = path.join(
      __dirname,
      "../../../packages/web/public/.well-known/apple-app-site-association"
    );
    const raw = fs.readFileSync(aasaPath, "utf8");
    const data = JSON.parse(stripBlockComment(raw));
    const detail = data.applinks.details[0];

    expect(detail.appIDs[0]).toMatch(/^[A-Z0-9_]+\.social\.linkora\.app$/);
    expect(detail.components.map((component) => component["/"])).toEqual(
      expect.arrayContaining(["/post/*", "/profile/*", "/pool/*", "/dm/*"])
    );
  });
});
