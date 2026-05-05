(() => {
	function detectLoginFormContext(activeField) {
		const inputs = getScopedVisibleInputs(activeField);
		const passwordInput = inputs.find((input) => normalizeInputType(input) === "password") || null;
		const usernameInput =
			findInputByHints(inputs, ["username", "email", "login", "user", "identifier", "account", "phone", "telefon"], ["text", "email", "tel"]) ||
			(passwordInput ? findPreviousInput(passwordInput, inputs, ["text", "email", "tel"]) : null) ||
			(isLikelyIdentifierInput(activeField) ? activeField : null);

		if (!passwordInput && !usernameInput) return null;
		if (!passwordInput && usernameInput && !isLikelyIdentifierInput(usernameInput)) return null;

		return {
			type: "login",
			usernameInput,
			passwordInput,
			anchorInput: activeField instanceof HTMLInputElement && inputs.includes(activeField) ? activeField : usernameInput || passwordInput,
		};
	}

	function detectCardFormContext(activeField) {
		const inputs = getScopedVisibleInputs(activeField);
		const context = {
			type: "credit_card",
			cardNumberInput: findInputByHints(inputs, ["cc-number", "cardnumber", "card-number", "ccnum", "kart no"], ["text", "tel"]),
			cardholderNameInput: findInputByHints(inputs, ["cc-name", "cardholder", "card-name", "kart sahibi"], ["text"]),
			cvvInput: findInputByHints(inputs, ["cc-csc", "cvv", "cvc", "security-code", "guvenlik"], ["text", "tel", "password"]),
			expiryInput: findInputByHints(inputs, ["cc-exp", "expiry", "expiration", "valid", "son kullanma"], ["text", "tel"]),
			expMonthInput: findInputByHints(inputs, ["cc-exp-month", "exp-month", "month", "ay"], ["text", "tel"]),
			expYearInput: findInputByHints(inputs, ["cc-exp-year", "exp-year", "year", "yil"], ["text", "tel"]),
			anchorInput: activeField instanceof HTMLInputElement ? activeField : null,
		};

		const score = [context.cardNumberInput, context.cardholderNameInput, context.cvvInput, context.expiryInput, context.expMonthInput, context.expYearInput].filter(Boolean).length;
		return score >= 2 ? context : null;
	}

	function detectIdentityFormContext(activeField) {
		const inputs = getScopedVisibleInputs(activeField);
		const context = {
			type: "identity",
			fullNameInput: findInputByHints(inputs, ["name", "full-name", "fullname", "ad soyad"], ["text"]),
			emailInput: findInputByHints(inputs, ["email", "e-mail", "mail"], ["email", "text"]),
			phoneInput: findInputByHints(inputs, ["tel", "phone", "mobile", "telefon"], ["tel", "text"]),
			organizationInput: findInputByHints(inputs, ["company", "organization", "org", "kurum", "sirket"], ["text"]),
			addressInput: findInputByHints(inputs, ["address", "street", "adres"], ["text"]),
			anchorInput: activeField instanceof HTMLInputElement ? activeField : null,
		};

		const score = [context.fullNameInput, context.emailInput, context.phoneInput, context.organizationInput, context.addressInput].filter(Boolean).length;
		return score >= 2 ? context : null;
	}

	function getScopedVisibleInputs(currentInput) {
		const scopeRoot = currentInput instanceof HTMLElement ? currentInput.closest("form") : null;
		const inputList = scopeRoot ? Array.from(scopeRoot.querySelectorAll("input")) : Array.from(document.querySelectorAll("input"));

		return inputList.filter((input) => {
			if (!(input instanceof HTMLInputElement)) return false;
			const type = normalizeInputType(input);
			if (input.disabled || type === "hidden") return false;
			const rect = input.getBoundingClientRect();
			const styles = window.getComputedStyle(input);
			return rect.width > 0 && rect.height > 0 && styles.display !== "none" && styles.visibility !== "hidden";
		});
	}

	function getBestAnchorInput() {
		const inputs = getScopedVisibleInputs(null);
		return inputs.find((input) => isLikelyIdentifierInput(input)) || inputs.find((input) => normalizeInputType(input) === "password") || inputs[0] || null;
	}

	function normalizeInputType(input) {
		return (input?.getAttribute("type") || "text").toLowerCase();
	}

	function getInputHintText(input) {
		if (!(input instanceof HTMLInputElement)) return "";
		return [input.name, input.id, input.placeholder, input.autocomplete, input.getAttribute("aria-label") || ""].join(" ").toLowerCase();
	}

	function isLikelyIdentifierInput(input) {
		if (!(input instanceof HTMLInputElement)) return false;
		const type = normalizeInputType(input);
		if (type === "email") return true;
		if (!["text", "email", "tel"].includes(type)) return false;
		const hintText = getInputHintText(input);
		return ["username", "email", "login", "user", "identifier", "account", "phone", "telefon"].some((hint) => hintText.includes(hint));
	}

	function findInputByHints(inputs, hints, allowedTypes) {
		return inputs.find((input) => allowedTypes.includes(normalizeInputType(input)) && hints.some((hint) => getInputHintText(input).includes(hint))) || null;
	}

	function findPreviousInput(input, inputs, allowedTypes) {
		const index = inputs.indexOf(input);
		if (index <= 0) return null;
		return [...inputs].slice(0, index).reverse().find((candidate) => allowedTypes.includes(normalizeInputType(candidate))) || null;
	}

	window.VaultMasterFormDetector = {
		detectLoginFormContext,
		detectCardFormContext,
		detectIdentityFormContext,
		getScopedVisibleInputs,
		getBestAnchorInput,
		normalizeInputType,
		getInputHintText,
		isLikelyIdentifierInput,
	};
})();
