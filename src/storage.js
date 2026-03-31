export const storage = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.error("Error reading from localStorage", e);
      return null;
    }
  },
  set: (key, val) => {
    try {
      localStorage.setItem(key, val);
    } catch (e) {
      console.error("Error writing to localStorage", e);
    }
  }
};
