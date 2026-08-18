// Mocha entry point, loaded by VS Code inside the extension host.
//
// The suites are imported statically rather than globbed off disk: this file is
// bundled, so there is no directory of test files at runtime to glob.

import Mocha from "mocha";

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 60_000 });

  // Registering suites requires the module to be evaluated *after* the Mocha
  // instance exists, because `suite`/`test` are globals Mocha installs.
  mocha.suite.emit("pre-require", global, "powerwiki", mocha);
  require("./powerwiki.test");

  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) failed.`));
          return;
        }
        resolve();
      });
    } catch (error: unknown) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
