# Ideas

### Future Exploratory TODOs
1. A weekly summary budget notification email to all the adults of the family. This email will give a brief picture of family finances.
    1. Current Assets & Liabilities Number along with subtle number representing how much it has changed from last week
    2. Total of Income Received for past week.
    3. Total of Expenses Done past Week - all expenses numbers rolled into one number
    4. The particular adults individual contribution to expense - value and percentage of total expense based on what accounts the expenses happened. 
    5. Expenses done on Grocery for that particular week.

2. Same as the first one but scaled to quarterly, bi-annually and annual time-range.

3. For Credit Card accounts - Bill Dates, Payment Due Dates and Payment reminders. The source for these dates can be manual, like one some more configuration attached to accounts in account list. Dates might be possibly variable as bill generation cycle can move based on days - but still it can be good enough for approximation and bill due week work.

4. Once fourth is implemented and solidified, maybe calendar on dashboard can highlight particular dates/week when some credit card bill is due. Most probably a couple of bills wil;l fall in same week - we need to handle representation to be top notch that user can identify clearly and quickly what needs to be paid when.

5. Weekly reminders can include the credit cards whose bill is due in upcoming week and maybe guess the bill amount based on transaction and bill cycle.

6. Accounts posted vs pending transaction often cause the balance to be not the true balance and different institutions handle it differently. Since we have list of transactions done and the base balance - can we show the variation of "Reported Balance" & "Estimated Balance".

7. Manual Account Creations for whom SimpleFin doesn't provide connectivity.

8. Manual Transactions for both
    1. Reporting transactions outside of banking/SimpleFin setup.
    2. Recording transactions for existing Institutions/Accounts setup. 
        1. Single Entry: Proactive reporting of transaction. 
        2. Bulk Upload: It will help to load past transactional data history past SimpleFins 90 days limit and Institutions like WealthSimple 30 day data scrapping limits. We can provide one excel  - prefilled with our format and all necessary data definition lists like Account/Categories which transaction belong. Would be simpler than supporting different format for different institutions/accounts.
    **?** Should this be a priority in pipeline? 

9. More configurable even to the level of title - "Panditas Wallet" can be "Johnsons Wallet", leaving on Johnson's machine/network and their own SimpleFin Bridge Account.

10. Already thought and should be soon in pipeline before anything else - to have mobile apps. Atleast read only data views for users. Need decisions on tech stack and architecture to support android and ios. Not everyone in family would be using same device type.
