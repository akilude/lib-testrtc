class Suite {
  constructor(name, config) {
    this.name = name;
    this.settings = config;
    this.tests = [];
  }

  getTests() {
    return this.tests;
  }

  add(test) {
    this.tests.push(test);
  }
}

export default Suite;
