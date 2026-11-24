const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const {
  PASS,
  WARN,
  NOTICE,
  INFO,
  ERROR,
  isBack
} = require('./cli-prompt');

const HUBSPOT_PORTAL_ID = '6434334';
const HUBSPOT_FORM_GUID = '94ca5423-e161-4b0e-84b0-a8d1e1724bf9';
const HUBSPOT_SUBMISSION_ENDPOINT = `https://api.hsforms.com/submissions/v3/integration/submit/${HUBSPOT_PORTAL_ID}/${HUBSPOT_FORM_GUID}`;
const HUBSPOT_SUBSCRIPTION_TYPE_IDS = [3514234990, 8397035, 7323267];
const FREE_EULA_URL = 'https://documentation.menditect.com/legal/eula-free';
const PRIVACY_POLICY_URL = 'https://documentation.menditect.com/legal/pp';
const HUBSPOT_PRIVACY_CONSENT_TEXT = 'Menditect needs the contact information you provide to us to provide this free service and to contact you about our products and services. You may unsubscribe from these communications at anytime. For information on how to unsubscribe, as well as our privacy practices and commitment to protecting your privacy, check out our Privacy Policy. Unsubscribing to the MTA exploratory subscription will lead to a revoke of your free MTA exploratory license.';
const SUCCESS_CONFIRMATION_MESSAGE = 'Thank you for requesting the MTA Exploratory Free Edition. Your license request was received and further instructions will be sent to you by email.';

const MAX_FIRSTNAME_LENGTH = 100;
const MAX_LASTNAME_LENGTH = 100;
const MAX_COMPANY_LENGTH = 150;
const MAX_EMAIL_LENGTH = 254;

const COMMON_FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.fr',
  'yahoo.de',
  'ymail.com',
  'rocketmail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.fr',
  'hotmail.de',
  'live.com',
  'live.nl',
  'live.co.uk',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'pm.me',
  'zoho.com',
  'zohomail.com',
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'web.de',
  'mail.com',
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  'tutanota.com',
  'tuta.io',
  'fastmail.com'
]);

let countriesList = [];
try {
  countriesList = require('./countries.json');
} catch (e) {
  countriesList = [
    { label: 'Netherlands', value: 'Netherlands' },
    { label: 'United States', value: 'United States' },
    { label: 'United Kingdom', value: 'United Kingdom' },
    { label: 'Germany', value: 'Germany' }
  ];
}

function generateFreeExploratoryToken() {
  let uuid = '';
  try {
    if (typeof crypto.randomUUID === 'function') {
      uuid = crypto.randomUUID();
    }
  } catch (e) {}

  if (!uuid) {
    const bytes = crypto.randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  return `mta_exploratory_free_${uuid}`;
}

function validateBusinessEmail(email) {
  const trimmed = String(email || '').trim();
  if (!trimmed) {
    return { valid: false, error: 'Email address is required.' };
  }
  if (trimmed.length > MAX_EMAIL_LENGTH) {
    return { valid: false, error: `Email address must be at most ${MAX_EMAIL_LENGTH} characters.` };
  }
  const emailRegex = /^[^\s@]+@([^\s@]+\.[^\s@]{2,})$/;
  const match = trimmed.match(emailRegex);
  if (!match) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }
  const domain = match[1].toLowerCase();
  if (COMMON_FREE_EMAIL_DOMAINS.has(domain)) {
    return {
      valid: false,
      error: `Please enter a business email address (free email providers like @${domain} are not allowed).`
    };
  }
  return { valid: true, email: trimmed };
}

async function promptCountry(ask, defaultCountry = 'Netherlands') {
  while (true) {
    console.log('\nEnter your country (or type part of the name to search, e.g. "Nether", "United", "Germ"):');
    const ans = await ask('Country', defaultCountry);
    if (isBack(ans)) return null;

    const trimmed = ans.trim();
    if (!trimmed) {
      console.log(`${ERROR} Country cannot be empty.`);
      continue;
    }

    // Exact match (case-insensitive)
    const exact = countriesList.find(c => c.value.toLowerCase() === trimmed.toLowerCase());
    if (exact) {
      return exact.value;
    }

    // Substring matches
    const matches = countriesList.filter(c => c.value.toLowerCase().includes(trimmed.toLowerCase()));
    if (matches.length === 1) {
      console.log(`Matched country: ${matches[0].value}`);
      return matches[0].value;
    }

    if (matches.length > 1 && matches.length <= 15) {
      console.log(`\nFound ${matches.length} matching countries:`);
      matches.forEach((c, idx) => {
        console.log(`  [${idx + 1}] ${c.value}`);
      });
      const pickAns = await ask(`Select country (1-${matches.length})`, '1');
      if (isBack(pickAns)) continue;
      const pickIdx = parseInt(pickAns, 10);
      if (!isNaN(pickIdx) && pickIdx >= 1 && pickIdx <= matches.length) {
        return matches[pickIdx - 1].value;
      }
      console.log(`${WARN} Invalid choice, please try again.`);
      continue;
    }

    if (matches.length > 15) {
      console.log(`${WARN} Too many matches (${matches.length}). Please type a more specific country name.`);
      continue;
    }

    console.log(`${WARN} Country "${trimmed}" was not recognized. Please type a valid country name.`);
  }
}

async function submitToHubSpot(data, token) {
  const payload = {
    submittedAt: Date.now(),
    fields: [
      { name: 'firstname', value: data.firstname.slice(0, MAX_FIRSTNAME_LENGTH) },
      { name: 'lastname', value: data.lastname.slice(0, MAX_LASTNAME_LENGTH) },
      { name: 'email', value: data.email.slice(0, MAX_EMAIL_LENGTH) },
      { name: 'company', value: data.company.slice(0, MAX_COMPANY_LENGTH) },
      { name: 'countryselect', value: data.country },
      { name: 'eula_mta_exploratory', value: 'true' },
      { name: 'app_instance_token', value: token }
    ],
    context: {
      pageUri: 'https://menditect.com/agentic-test-workspace',
      pageName: 'Menditect Agentic Test Workspace Setup'
    },
    legalConsentOptions: {
      legitimateInterest: {
        value: true,
        subscriptionTypeId: HUBSPOT_SUBSCRIPTION_TYPE_IDS[0],
        subscriptionTypeIds: [...HUBSPOT_SUBSCRIPTION_TYPE_IDS],
        legalBasis: 'CUSTOMER',
        text: HUBSPOT_PRIVACY_CONSENT_TEXT
      }
    }
  };

  const response = await fetch(HUBSPOT_SUBMISSION_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const rawText = await response.text().catch(() => '');
  if (response.status === 200 || response.status === 204) {
    return { success: true };
  }

  let errorMessage = `HubSpot API returned status ${response.status}.`;
  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
      errorMessage = parsed.errors.map(e => e.message || e.errorType).join('; ');
    } else if (parsed?.message) {
      errorMessage = parsed.message;
    }
  } catch (e) {}

  return { success: false, status: response.status, error: errorMessage };
}

async function requestFreeLicenseInteractive(ask) {
  console.log('\n================================================================================');
  console.log(' REQUEST MTA EXPLORATORY FREE EDITION LICENSE');
  console.log('================================================================================');
  console.log(' You can register for an MTA Exploratory Free Edition license right here in the CLI.');
  console.log(' An Application Instance Token will be generated and registered to your business email.');
  console.log(' (Note: A business email address is required. Free email providers are not accepted.)');
  console.log('================================================================================\n');

  let firstName = '';
  while (!firstName) {
    const ans = await ask('First Name');
    if (isBack(ans)) return { aborted: true };
    firstName = ans.trim();
    if (!firstName) {
      console.log(`${ERROR} First name cannot be empty.`);
    } else if (firstName.length > MAX_FIRSTNAME_LENGTH) {
      console.log(`${ERROR} First name must be under ${MAX_FIRSTNAME_LENGTH} characters.`);
      firstName = '';
    }
  }

  let lastName = '';
  while (!lastName) {
    const ans = await ask('Last Name');
    if (isBack(ans)) return { aborted: true };
    lastName = ans.trim();
    if (!lastName) {
      console.log(`${ERROR} Last name cannot be empty.`);
    } else if (lastName.length > MAX_LASTNAME_LENGTH) {
      console.log(`${ERROR} Last name must be under ${MAX_LASTNAME_LENGTH} characters.`);
      lastName = '';
    }
  }

  let email = '';
  while (!email) {
    const ans = await ask('Business Email Address');
    if (isBack(ans)) return { aborted: true };
    const valRes = validateBusinessEmail(ans);
    if (!valRes.valid) {
      console.log(`${ERROR} ${valRes.error}`);
    } else {
      email = valRes.email;
    }
  }

  let company = '';
  while (!company) {
    const ans = await ask('Company Name');
    if (isBack(ans)) return { aborted: true };
    company = ans.trim();
    if (!company) {
      console.log(`${ERROR} Company name cannot be empty.`);
    } else if (company.length > MAX_COMPANY_LENGTH) {
      console.log(`${ERROR} Company name must be under ${MAX_COMPANY_LENGTH} characters.`);
      company = '';
    }
  }

  const country = await promptCountry(ask);
  if (!country) return { aborted: true };

  console.log('\nTerms & Conditions:');
  console.log(` • MTA Exploratory EULA: ${FREE_EULA_URL}`);
  console.log(' • Privacy Policy: https://documentation.menditect.com/legal/pp');
  console.log('   Menditect needs the contact information you provide to us to provide this free');
  console.log('   service and to contact you about our products and services. You may unsubscribe');
  console.log('   from these communications at anytime. For information on how to unsubscribe, as');
  console.log('   well as our privacy practices and commitment to protecting your privacy, check out');
  console.log('   our Privacy Policy: https://documentation.menditect.com/legal/pp');
  console.log('   Unsubscribing to the MTA exploratory subscription will lead to a revoke of your free MTA exploratory license.\n');
  let eulaAccepted = false;
  while (!eulaAccepted) {
    const ans = await ask('Do you accept the terms of the MTA Exploratory EULA? (y/n)', 'y');
    if (isBack(ans)) return { aborted: true };
    if (ans.toLowerCase().startsWith('y')) {
      eulaAccepted = true;
    } else {
      console.log(`${ERROR} You must accept the MTA Exploratory EULA to receive a free license.`);
      const retry = await ask('Would you like to review and accept now? (y/n)', 'n');
      if (!retry.toLowerCase().startsWith('y')) {
        return { aborted: true };
      }
    }
  }

  const generatedToken = generateFreeExploratoryToken();

  console.log('\nSubmitting free license request to Menditect...');
  try {
    const submitRes = await submitToHubSpot({
      firstname: firstName,
      lastname: lastName,
      email,
      company,
      country
    }, generatedToken);

    if (submitRes.success) {
      console.log('\n================================================================================');
      console.log(`${PASS} Request Received`);
      console.log('================================================================================');
      console.log(` ${SUCCESS_CONFIRMATION_MESSAGE}`);
      console.log('--------------------------------------------------------------------------------');
      console.log(` Next step: Check your inbox at ${email} for your Free Exploratory ApplicationInstanceToken, then paste it into your workspace configuration.`);
      console.log('================================================================================\n');

      return {
        success: true,
        token: generatedToken,
        email,
        company,
        country,
        firstname: firstName,
        lastname: lastName,
        message: SUCCESS_CONFIRMATION_MESSAGE
      };
    } else {
      console.log(`\n${ERROR} License request could not be submitted: ${submitRes.error}`);
      return { success: false, error: submitRes.error, token: generatedToken };
    }
  } catch (err) {
    console.log(`\n${ERROR} Failed to connect to license registration service: ${err.message}`);
    return { success: false, error: err.message, token: generatedToken };
  }
}

function loadCountries() {
  return countriesList;
}

function validateFreeLicenseFields(body = {}) {
  const firstName = String(body.firstName || body.firstname || '').trim();
  if (!firstName) {
    return { valid: false, field: 'firstName', error: 'First name cannot be empty.' };
  }
  if (firstName.length > MAX_FIRSTNAME_LENGTH) {
    return { valid: false, field: 'firstName', error: `First name must be under ${MAX_FIRSTNAME_LENGTH} characters.` };
  }

  const lastName = String(body.lastName || body.lastname || '').trim();
  if (!lastName) {
    return { valid: false, field: 'lastName', error: 'Last name cannot be empty.' };
  }
  if (lastName.length > MAX_LASTNAME_LENGTH) {
    return { valid: false, field: 'lastName', error: `Last name must be under ${MAX_LASTNAME_LENGTH} characters.` };
  }

  const emailRes = validateBusinessEmail(body.email);
  if (!emailRes.valid) {
    return { valid: false, field: 'email', error: emailRes.error };
  }

  const company = String(body.company || '').trim();
  if (!company) {
    return { valid: false, field: 'company', error: 'Company name cannot be empty.' };
  }
  if (company.length > MAX_COMPANY_LENGTH) {
    return { valid: false, field: 'company', error: `Company name must be under ${MAX_COMPANY_LENGTH} characters.` };
  }

  const country = String(body.country || '').trim();
  if (!country) {
    return { valid: false, field: 'country', error: 'Country selection is required.' };
  }

  if (body.eulaAccepted === false) {
    return { valid: false, field: 'eulaAccepted', error: 'You must accept the MTA Exploratory EULA to receive a free license.' };
  }

  return {
    valid: true,
    firstname: firstName,
    lastname: lastName,
    email: emailRes.email,
    company,
    country
  };
}

module.exports = {
  HUBSPOT_PORTAL_ID,
  HUBSPOT_FORM_GUID,
  HUBSPOT_SUBMISSION_ENDPOINT,
  HUBSPOT_SUBSCRIPTION_TYPE_IDS,
  FREE_EULA_URL,
  COMMON_FREE_EMAIL_DOMAINS,
  loadCountries,
  validateFreeLicenseFields,
  generateFreeExploratoryToken,
  validateBusinessEmail,
  promptCountry,
  submitToHubSpot,
  requestFreeLicenseInteractive
};
