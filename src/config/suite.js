class Suite {
  constructor(name, config) {
    this.name = name;
    this.settings = config;
    this.tests = [];
  }

  getName() {
    return this.name;
  }

  getTests() {
    return this.tests;
  }

  add(test) {
    this.tests.push(test);
  }
}

export default Suite;
