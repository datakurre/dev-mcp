{ pkgs, ... }:
{
  profiles.shell.module = {
    packages = [
      pkgs.git
      pkgs.nodejs
      pkgs.claude-code
    ];
  };
}
