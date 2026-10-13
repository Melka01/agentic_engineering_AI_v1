/**
 * Keyword lexicons shared by the deterministic story extractor and the
 * blueprint synthesisers.
 */
import type { NfrCategory } from '../shared/domain.js';

export const NFR_LEXICON: readonly { readonly category: NfrCategory; readonly pattern: RegExp }[] = [
  { category: 'availability', pattern: /\b(availab\w*|uptime|downtime|24\/7|99[.,]\d+\s*%)/i },
  {
    category: 'performance',
    pattern: /\b(response times?|respond\w*|latency|load(?:s|ed)? (?:with)?in|page loads?|throughput|performance)\b/i,
  },
  {
    category: 'scalability',
    pattern:
      /\b(concurrent|simultaneous|scal(?:e|able|ability)|peak load|\d[\d,.]*k?\s+(?:users|records|transactions|requests)\b)/i,
  },
  { category: 'reliability', pattern: /\b(backups?|recover\w*|RPO|RTO|failover|data loss|disaster)\b/i },
  {
    category: 'security',
    pattern:
      /\b(secur\w*|encrypt\w*|authenticat\w*|authori[sz]\w*|SSO|single sign-on|MFA|2FA|multi-factor|role-based|RBAC|passwords?|OWASP|penetration test\w*|audit (?:trail|log)s?)\b/i,
  },
  {
    category: 'compliance',
    pattern:
      /\b(GDPR|AVG|HIPAA|SOX|PCI[- ]DSS|ISO ?27001|NEN ?7510|compliance|complian\w*|regulat\w*|retention|privacy)\b/i,
  },
  { category: 'usability', pattern: /\b(accessib\w*|WCAG|usability|multilingual|languages?)\b/i },
  { category: 'maintainability', pattern: /\b(maintainab\w*|modular\w*|technical debt|code quality)\b/i },
  { category: 'interoperability', pattern: /\b(interoperab\w*|open standards?|OData|OpenAPI)\b/i },
];

export const KNOWN_SYSTEMS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'SAP', pattern: /\bSAP\b/ },
  { name: 'Salesforce', pattern: /\bSalesforce\b/i },
  { name: 'Workday', pattern: /\bWorkday\b/i },
  { name: 'Exact', pattern: /\bExact Online\b|\bExact\b(?= (?:ERP|Online|Globe))/ },
  { name: 'AFAS', pattern: /\bAFAS\b/i },
  { name: 'Dynamics', pattern: /\b(?:MS |Microsoft )?Dynamics(?: 365)?\b/i },
  { name: 'ServiceNow', pattern: /\bServiceNow\b/i },
  { name: 'SharePoint', pattern: /\bSharePoint\b/i },
  { name: 'Outlook', pattern: /\bOutlook\b|\bExchange\b/i },
  { name: 'Teams', pattern: /\bMicrosoft Teams\b|\bMS Teams\b/i },
  { name: 'EntraID', pattern: /\b(?:Azure AD|Entra ID|Active Directory)\b/i },
  { name: 'Stripe', pattern: /\bStripe\b/i },
  { name: 'Adyen', pattern: /\bAdyen\b/i },
  { name: 'Mollie', pattern: /\bMollie\b/i },
  { name: 'DocuSign', pattern: /\bDocuSign\b/i },
  { name: 'Twilio', pattern: /\bTwilio\b/i },
  { name: 'Oracle', pattern: /\bOracle\b/i },
  { name: 'Erp', pattern: /\bERP\b/ },
  { name: 'Crm', pattern: /\bCRM\b/ },
  { name: 'HrSystem', pattern: /\bHR(?:IS| system)\b/i },
  { name: 'PaymentProvider', pattern: /\bpayment (?:provider|gateway|service)\b/i },
];

export const TAG_LEXICON: readonly { readonly tag: string; readonly pattern: RegExp }[] = [
  {
    tag: 'offline',
    pattern: /\b(offline|without (?:an? )?(?:internet|connection|connectivity)|no (?:network|connectivity))\b/i,
  },
  { tag: 'search', pattern: /\b(search\w*|find|filter\w*|look up|browse)\b/i },
  { tag: 'reporting', pattern: /\b(reports?|reporting|dashboards?|export\w*|analytics|KPIs?|overview of)\b/i },
  { tag: 'bulk', pattern: /\b(bulk|batch\w*|import\w*|mass|nightly|every night|in one go)\b/i },
  {
    tag: 'approval',
    pattern:
      /\b(approve|approves|approving|approval|reject|rejects|rejecting|sign[- ]off|review|reviews|reviewing|authori[sz]e)\b/i,
  },
  { tag: 'notification', pattern: /\b(notif\w*|remind\w*|alert\w*|e-?mails?|SMS|push messages?)\b/i },
  { tag: 'document', pattern: /\b(upload\w*|attach\w*|receipts?|documents?|PDFs?|scan\w*|photos?)\b/i },
  { tag: 'mobile', pattern: /\b(mobile|smartphone|phone|tablet|on the road|in the field)\b/i },
];

export type VerbClass = 'create' | 'update' | 'approve' | 'view' | 'delete' | 'export' | 'notify' | 'import' | 'other';

export const VERB_CLASSES: readonly { readonly cls: VerbClass; readonly verbs: readonly string[] }[] = [
  {
    cls: 'approve',
    verbs: ['approve', 'reject', 'review', 'sign', 'authorise', 'authorize', 'confirm', 'accept', 'decline'],
  },
  { cls: 'import', verbs: ['import', 'sync', 'synchronise', 'synchronize', 'migrate'] },
  { cls: 'export', verbs: ['export', 'download', 'print', 'report', 'generate', 'analyse', 'analyze'] },
  { cls: 'notify', verbs: ['notify', 'remind', 'alert', 'send', 'email', 'inform', 'escalate'] },
  { cls: 'delete', verbs: ['delete', 'remove', 'cancel', 'archive', 'withdraw', 'close'] },
  {
    cls: 'update',
    verbs: [
      'edit',
      'update',
      'change',
      'modify',
      'correct',
      'assign',
      'reassign',
      'manage',
      'maintain',
      'configure',
      'set',
    ],
  },
  {
    cls: 'view',
    verbs: [
      'view',
      'see',
      'search',
      'find',
      'list',
      'browse',
      'track',
      'check',
      'filter',
      'monitor',
      'consult',
      'look',
      'read',
      'follow',
    ],
  },
  {
    cls: 'create',
    verbs: [
      'submit',
      'create',
      'register',
      'add',
      'request',
      'book',
      'enter',
      'record',
      'upload',
      'capture',
      'apply',
      'place',
      'log',
      'file',
      'open',
      'schedule',
      'plan',
      'invite',
      'order',
      'declare',
    ],
  },
];

export function verbClassOf(verb: string): VerbClass {
  const lower = verb.toLowerCase();
  for (const { cls, verbs } of VERB_CLASSES) {
    if (
      verbs.some(
        (v) => lower === v || lower === `${v}s` || lower === `${v}es` || lower === `${v}d` || lower === `${v}ed`,
      )
    )
      return cls;
  }
  return 'other';
}

export const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'my',
  'our',
  'their',
  'his',
  'her',
  'its',
  'all',
  'any',
  'each',
  'every',
  'new',
  'existing',
  'own',
  'some',
  'this',
  'that',
  'these',
  'those',
  'relevant',
  'related',
  'current',
  'open',
  'pending',
  'outstanding',
  'previous',
  'past',
  'recent',
  'old',
  'approved',
  'rejected',
  'submitted',
  'completed',
  'active',
  'other',
  'single',
  'multiple',
  'specific',
  'individual',
  'personal',
  'selected',
  'available',
]);

export const PHRASE_BREAKERS = new Set([
  'with',
  'for',
  'to',
  'from',
  'by',
  'in',
  'on',
  'at',
  'via',
  'and',
  'or',
  'so',
  'that',
  'when',
  'if',
  'within',
  'using',
  'per',
  'into',
  'through',
  'before',
  'after',
  'during',
  'of',
  'which',
  'who',
  'where',
  'while',
  'as',
  'without',
  'under',
  'than',
  'about',
  'once',
  'whenever',
]);
