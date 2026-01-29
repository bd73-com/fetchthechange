{ pkgs }: {
  deps = [
    pkgs.playwright
    pkgs.nodejs-18_x
    pkgs.nodePackages.typescript
    pkgs.nodePackages.npm
    pkgs.chromium
    pkgs.playwright-driver
  ];
}