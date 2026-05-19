(() => {
	const SOURCE = "vaultmaster-passkey-injected";
	const CONTENT_SOURCE = "vaultmaster-passkey-content";
	const originalCredentials = navigator.credentials;

	if (!originalCredentials || window.__vaultmasterPasskeyInjected) {
		return;
	}

	window.__vaultmasterPasskeyInjected = true;

	function postPasskeyNotice(operation, options) {
		const publicKey = options?.publicKey;
		const rpId = operation === "create" ? publicKey?.rp?.id : publicKey?.rpId;

		window.postMessage(
			{
				source: SOURCE,
				type: "VM_PASSKEY_INTERCEPTED",
				operation,
				requestId: `passkey-${Date.now()}-${Math.random().toString(16).slice(2)}`,
				payload: {
					rpId: typeof rpId === "string" ? rpId : "",
					origin: window.location.origin,
				},
			},
			window.location.origin
		);
	}

	function notifyAndContinue(operation, options, fallback) {
		try {
			postPasskeyNotice(operation, options);
		} catch {
			// Never break native WebAuthn if VaultMaster cannot observe the request.
		}

		return fallback.call(originalCredentials, options);
	}

	const wrappedCredentials = Object.create(originalCredentials);

	wrappedCredentials.create = function create(options) {
		if (options?.publicKey) {
			return notifyAndContinue("create", options, originalCredentials.create);
		}
		return originalCredentials.create.call(originalCredentials, options);
	};

	wrappedCredentials.get = function get(options) {
		if (options?.publicKey) {
			return notifyAndContinue("get", options, originalCredentials.get);
		}
		return originalCredentials.get.call(originalCredentials, options);
	};

	Object.defineProperty(navigator, "credentials", {
		value: wrappedCredentials,
		configurable: true,
	});

	window.addEventListener("message", (event) => {
		if (event.source !== window || event.origin !== window.location.origin) {
			return;
		}

		const data = event.data;
		if (data?.source !== CONTENT_SOURCE || data.type !== "VM_PASSKEY_NOTICE") {
			return;
		}

		// Intentionally notification-only. No credential creation, signing, or secret material crosses this bridge yet.
	}, true);
})();
