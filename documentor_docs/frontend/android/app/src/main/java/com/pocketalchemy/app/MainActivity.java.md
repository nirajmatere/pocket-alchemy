# Technical Documentation: `MainActivity.java`

**File Location:** `frontend/android/app/src/main/java/com/pocketalchemy/app/MainActivity.java`

---

## Overview

The `MainActivity.java` file acts as the primary Android entry point for the Pocket Alchemy application. It is a standard component of applications built using [Capacitor](https://capacitorjs.com/) (an open-source native runtime for web apps).

---

## Code Breakdown

```java
package com.pocketalchemy.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
```

### 1. Package Declaration
```java
package com.pocketalchemy.app;
```
* **Purpose:** Defines the unique Java package namespace for the application. This corresponds to the Android application ID (`com.pocketalchemy.app`).

### 2. Imports
```java
import com.getcapacitor.BridgeActivity;
```
* **Purpose:** Imports the `BridgeActivity` class from the Capacitor library (`com.getcapacitor`).

### 3. Class Definition
```java
public class MainActivity extends BridgeActivity {}
```
* **Class Name:** `MainActivity`
* **Inheritance:** Extends `BridgeActivity`.
* **Implementation Details:** The class body is currently empty (`{}`). It relies entirely on the default functionality inherited from Capacitor's `BridgeActivity`.

---

## How It Works

1. **Application Launch:** When the Android operating system starts the application, `MainActivity` is instantiated as the main entry point activity defined in the `AndroidManifest.xml`.
2. **Capacitor Initialization:** By extending `BridgeActivity`, `MainActivity` automatically inherits the core runtime behavior required to load and serve the frontend web application within an Android WebView.
3. **Bridge Functionality:** The inherited `BridgeActivity` manages:
   * Loading the web application assets.
   * Setting up the bridge between the native Android environment and the web JavaScript environment.
   * Handling native Android application lifecycle events.

---

## Summary

`MainActivity.java` is a minimal, boilerplate integration class. It provides the native Android container for the Capacitor web view without requiring any custom Java logic or method overrides in its current implementation.