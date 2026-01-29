{ pkgs }: {
  deps = [
    pkgs.nodejs-18_x
    pkgs.nodePackages.typescript
    pkgs.nodePackages.npm
    pkgs.chromium
    pkgs.playwright-driver
  ];
}